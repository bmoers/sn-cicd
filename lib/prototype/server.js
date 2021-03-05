const Promise = require('bluebird');
const fs = require('fs-extra');
const path = require("path");
const express = require('express');
const compression = require('compression')
const bodyParser = require('body-parser');
const http = require('http');
const https = require('https');
const assign = require('object-assign-deep');

const EbQueueJob = require('../eb/queue-job');

const httpPort = process.env.CICD_WEB_HTTP_PORT_INTERNAL || 8080;
const certDir = path.join(__dirname, '../', '../', 'cert');
const webDir = process.env.CICD_WEB_DIR || path.resolve(__dirname, '../', '../', 'web');

const httpsPort = process.env.CICD_WEB_HTTPS_PORT_INTERNAL;
const httpsKey = process.env.CICD_WEB_HTTPS_KEY || path.resolve(certDir, 'server-key.pem');
const httpsCert = process.env.CICD_WEB_HTTPS_CERT || path.resolve(certDir, 'server-crt.pem');
const httpsCa = (process.env.CICD_WEB_HTTPS_CA !== undefined) ? process.env.CICD_WEB_HTTPS_CA : path.resolve(certDir, 'server-ca-crt.pem');

const secure = (httpsPort !== undefined && httpsKey !== undefined && httpsCert !== undefined);

const figlet = require('figlet');

/**
 * Implements CICD.server()
 *
 */
module.exports = function () {

    console.log(`Version: ${require('../../package.json').version}\n${'* '.repeat(70)}\n${figlet.textSync('CICD SERVER', { font: 'Larry 3D', horizontalLayout: 'full', verticalLayout: 'default' })
        }\n${'* '.repeat(70)}`);

    const self = this;
    const slack = self.getSlack();

    const isPortAvailable = (port) => new Promise((resolve, reject) => {
        if (!port)
            reject(Error('Port NR required'));

        var net = require('net');
        const tester = net.createServer()
            .once('error', (err) => { return (err.code == 'EADDRINUSE' ? resolve(false) : reject(err)) })
            .once('listening', () => tester.once('close', () => resolve(true)).close())
            .listen(port);
    });

    const serverPort = secure ? httpsPort : httpPort;

    return self.init(self.SERVER).then(() => {

        return isPortAvailable(httpPort).then((free) => {
            if (!free)
                throw Error(`Port ${httpPort} is already in use`);
        }).then(() => {
            if (secure)
                return isPortAvailable(httpsPort).then((free) => {
                    if (!free)
                        throw Error(`Port ${httpsPort} is already in use`);
                });
        });

    }).then(async () => {

        const eventBusServer = require('../eb/server').call(self);

        // TODO: start one worker thread in server mode
        //this.worker(1);

        const app = express();

        // enable gzip compression on the /dao routes
        app.use(compression({
            filter: (req, res) => {
                return (req.baseUrl == '/dao');
            }
        }));

        app.use((req, res, next) => {
            bodyParser.json({
                limit: '10mb', // 10mb, default to 100kb 
                verify: (req2, res, buf) => {
                    req2.rawBody = buf.toString();
                }
            })(req, res, (err) => {
                if (err) {
                    console.log(err);
                    res.sendStatus(400);
                    return;
                }
                next();
            });
        });
        app.use(bodyParser.urlencoded({
            limit: '10mb',
            extended: true
        }));

        const server = (() => {
            if (secure) {
                // redirect 
                const redirect = express();
                const concat = require('concat-stream');
                redirect.use(function (req, res, next) {
                    req.pipe(concat(function (data) {
                        req.body = data.toString();
                        next();
                    }));
                });
                redirect.enable('trust proxy');
                /*
                redirect.get('*', function (req, res) {
                    const target = `https://${req.headers.host.split(':')[0]}:${process.env.CICD_WEB_HTTPS_PORT}${req.url}`;
                    console.log("redirect to", target)
                    res.redirect(target);
                });*/
                redirect.all('*', function (req, res) {
                    console.log(`${req.ip}\t${req.headers.host}\t${req.method}\t${req.url}\t${JSON.stringify(req.headers)}\t${req.body}`);
                    if ('GET' == req.method) {
                        const target = `https://${req.headers.host.split(':')[0]}:${process.env.CICD_WEB_HTTPS_PORT}${req.url}`;
                        console.log("redirect to", target)
                        return res.redirect(target);
                    }
                    return res.sendStatus(403);
                })
                redirect.listen(httpPort);
                console.log('Redirect Server started on port', httpPort, 'to port', process.env.CICD_WEB_HTTPS_PORT);

                return https.createServer({
                    key: fs.readFileSync(httpsKey),
                    cert: fs.readFileSync(httpsCert),
                    ca: (httpsCa) ? fs.readFileSync(httpsCa) : null
                }, app);
            } else {
                return http.createServer(app);
            }
        })();

        // event bus info
        app.get('/eb/jobs', function (req, res) {
            res.json(eventBusServer.getJobs());
        });
        app.get('/eb/exe', function (req, res) {
            res.json(eventBusServer.getExeJobs());
        });
        app.get('/eb/worker', function (req, res) {
            res.json(eventBusServer.getWorkerNodes());
        });

        app.use('/build', require('./server/build').call(self));
        app.use('/deploy', require('./server/deploy').call(self));
        app.use('/dao', require('./server/dao').call(self));

        if ('mongo' == self.settings.dataStore.type && 'true' == process.env.CICD_DB_MONGO_EXPRESS_UI_ENABLED) {

            const mongo_express = require('mongo-express/lib/middleware');

            let config = assign(require('mongo-express/config.default'), {
                mongodb: {
                    admin: false,
                    connectionString: process.env.CICD_DB_MONGO_URL,
                    connectionOptions: {
                        useNewUrlParser: true,
                        useUnifiedTopology: true,
                        autoReconnect: undefined
                    }
                },
                basicAuth: {
                    username: process.env.CICD_DB_MONGO_EXPRESS_UI_USER || Math.random().toString(),
                    password: process.env.CICD_DB_MONGO_EXPRESS_UI_PASSWORD || Math.random().toString()
                },
                useBasicAuth: (process.env.CICD_DB_MONGO_EXPRESS_UI_USER && process.env.CICD_DB_MONGO_EXPRESS_UI_PASSWORD ),
                options: {
                    console: false,
                    logger: { skip: () => true },
                    collapsibleJSON: true
                }
            })

            if (process.env.CICD_DB_MONGO_EXPRESS_ADMIN_USER && process.env.CICD_DB_MONGO_EXPRESS_ADMIN_PASSWORD) {

                // parse the server and port information from the connection string
                const prsHost = /^(mongodb:(?:\/{2})?)((?<name>[^:]+?):(?<password>[^@]+?)@|:?@?)(?<server>[^:@]+?)(:(?<port>\d+))?\/(?<dbName>\w+?)$/;
                const match = prsHost.exec(process.env.CICD_DB_MONGO_URL);

                // set the connection string with the admin credentials and remove the dbName
                config = assign(config, {
                    mongodb: {
                        admin: true,
                        connectionString: `mongodb://${process.env.CICD_DB_MONGO_EXPRESS_ADMIN_USER}:${process.env.CICD_DB_MONGO_EXPRESS_ADMIN_PASSWORD}@${match.groups.server}:${match.groups.port}`
                    }
                });

            }

            app.use('/mongo_express', await mongo_express(config));
            console.log(`MongoDB Admin UI available under /mongo_express`);
        }


        app.use('/source', require('./server/source').call(self));

        // web app
        app.use('/', express.static(webDir));

        // generated documents
        app.use('/doc', express.static(path.resolve(self.settings.documentsRootDir)));

        // short links 
        app.route('/goto/:type/:id').get((req, res) => {
            if ('us' == req.params.type) {
                return self.db.us.find({
                    updateSetId: req.params.id
                }).then((result) => {
                    if (!result || !result.length)
                        return res.redirect('/');

                    const us = result[0];
                    if (us.appId) {
                        if (us.runId) {
                            res.redirect(`/steps/#/app/${us.appId}/us/${us._id}/run/${us.runId}`);
                        } else {
                            res.redirect(`/runs/#/app/${us.appId}/us/${us._id}/`);
                        }
                    } else {
                        res.redirect('/');
                    }
                });
            } else if ('run' == req.params.type) {
                return self.db.run.get(req.params.id).then((run) => {
                    if (!run)
                        return res.redirect('/');

                    if (run.appId && run.usId) {
                        res.redirect(`/steps/#/app/${run.appId}/us/${run.usId}/run/${run._id}`);
                    } else {
                        res.redirect('/');
                    }

                });
            } else if ('collision-us' == req.params.type) {
                return self.db.run.findOne({
                    "collision.remoteUpdateSetID": req.params.id
                }).then((run) => {
                    if (!run)
                        return res.redirect('/');

                    res.redirect(`/steps/#/app/${run.appId}/us/${run.usId}/run/${run._id}`);
                })
            }

            res.redirect('/');
        });

        /**
         * Start the Code Extraction and run 'buildProject' if CICD_EMBEDDED_BUILD is enabled.
         * 
         * Optionally the build process can be executed by a CICD Pipeline (GitLabCi, Bamboo, etc)
         * 
         */
        app.route('/run').post((req, res) => {
            return this.convertBuildBody(req.body).then((options) => {
                console.log("Start CI/CD - updateSet: %j, application: %j, git: %j", options.updateSet, options.application, options.git);

                return self.db.us.findOne({
                    updateSetId: options.updateSet
                }).then((_us) => {
                    if (_us && _us.running)
                        //throw 'job already running';
                        throw Error('there is already a job running for this update-set');
                    if (_us && _us.pullRequestRaised)
                        throw Error('there is already a pending pull request for this update-set');

                    // check if the pr was reopened in the repo
                    return Promise.resolve().then(() => {
                        if (!_us || !_us.runId)
                            return;
                        const runId = _us.runId;
                        return self.db.run.get({ _id: runId }).then((run) => {
                            if (!run || !run.config)
                                return;

                            const config = run.config;
                            return self.pendingPullRequest({
                                config,
                                repoName: config.git.repository,
                                from: config.branchName
                            }).then((pending) => {
                                if (!pending)
                                    return;
                                // update status
                                _us.pullRequestRaised = true;
                                return self.db.us.update(_us).then(() => {
                                    throw Error('there is already a pending pull request for this update-set');
                                });
                            });
                        });
                    });
                }).then(() => {
                    return new EbQueueJob({ name: 'run', background: true, description: `Build UpdateSet ${options.updateSet}` }, options).then((result) => {
                        return res.json({
                            run: 'added-to-queue',
                            result,
                            status: `/run/${result.id}`
                        });
                    });
                });

            }).catch((e) => {
                console.error(e.message);
                return res.status(400).send(e.message);
            });
        });


        app.route('/deployment-complete').post((req, res) => {
            let config = {},
                error;

            const payload = assign({
                remoteUpdateSetID: null,
                isInteractive: null, // true == via UI, false == REST !! the event of complete an update set is also NOT interactive!
                user: {
                    name: null,
                    fullName: null,
                    email: null
                },
                resolutions: {}
            }, req.body);

            //console.log("deployment complete")
            //console.log(payload);

            return self.db.deployment.findOne({
                remoteUpdateSetID: payload.remoteUpdateSetID,
                //state: { $in: ['manual_interaction', 'running', 'missing_references'] }
            }).then((deployment) => {
                if (!deployment) {
                    //console.warn(`No 'running' deployment not found with 'remoteUpdateSetID' ${payload.remoteUpdateSetID}`)
                    return res.json({ message: `No 'running' deployment not found with 'remoteUpdateSetID' ${payload.remoteUpdateSetID}` });
                }

                const { host, user } = payload;
                const resolutions = typeof (payload.resolutions) == 'object' ? payload.resolutions : {};

                deployment.state = 'completed'
                deployment.solution = { host, user, resolutions };

                return self.db.deployment.update(deployment).then((deployment) => {

                    return self.db.run.get(deployment.runId).then((run) => {

                        if (!run) {
                            //console.warn(`Run not found with 'id' ${deployment.runId}`)
                            return res.json({ message: `Run not found with 'id' ${deployment.runId}` });
                        }

                        config = run.config;
                        const { host, user, resolutions } = deployment.solution

                        // merge the resolution from current run with the existing one
                        // this information is not updated in the update set xml
                        if (!run.collision || !run.collision.solution || !run.collision.solution.resolutions) {
                            if (!run.collision) {
                                run.collision = { solution: { resolutions: {} } }
                            }
                            run.collision.solution = { host, user, resolutions };
                        } else {
                            assign(run.collision.solution.resolutions, resolutions);
                        }

                        return self.db.run.update(run).then((run) => {
                            return res.json(run.collision);
                        });
                    });
                });

            }).catch((e) => {
                error = e;
                console.error(e);
                return res.status(400).send(e.message);
            }).finally(() => {
                //console.log("/deployment-complete ", config)
                if (config && config.build && config.build.runId)
                    return self.finalizeRun(config, error);
            });
        });


        app.route('/preview-complete').post((req, res) => {

            const payload = assign({
                remoteUpdateSetID: null,
                doCancel: null, // 'chancel job'
                user: {
                    name: null,
                    fullName: null,
                    email: null
                },
                resolutions: {}
            }, req.body);

            //console.log("Preview complete", payload);

            return self.db.run.findOne({
                "collision.remoteUpdateSetID": payload.remoteUpdateSetID
            }).then((run) => {
                if (!run)
                    throw Error(`Run not found with 'collision.remoteUpdateSetID' ${payload.remoteUpdateSet}`);

                if (payload.doCancel) {
                    return Promise.try(() => {
                        return self.setRunState(run, self.run.CONFLICT_PREVIEW_CANCELLED);
                    }).then(() => {
                        run.running = false;
                        run.collision.state = 'cancelled';
                        run.collision.collisionResolved = false;

                        return self.db.run.update(run);
                    }).then(() => {
                        return self.setProgress(run.config, this.build.CANCELLED);
                    }).then(() => {
                        return slack.build.failed(`*${run.config.application.name} › ${run.config.updateSet.name} › #${run.sequence}*\nPREFLIGHT CONFLICTS - Conflict Preview Cancelled!\n\n<${run.config.application.docUri}|details>`);
                    }).then(() => {

                        return res.json({
                            url: `/goto/run/${run._id}`
                        });
                    });
                }

                return Promise.try(() => {
                    return self.setRunState(run, self.run.CONFLICT_RESOLVED);
                }).then(() => {
                    const { user, resolutions } = payload;

                    run.collision.state = 'passed';
                    run.collision.collisionResolved = true;

                    run.collision.solution = { user, resolutions };
                    return self.db.run.update(run);
                }).then(() => {
                    return slack.build.complete(`*${run.config.application.name} › ${run.config.updateSet.name} › #${run.sequence}*\nPREFLIGHT CONFLICTS - Conflict Resolved!\n\n${run.collision.solution.user.fullName} resolved all conflicts. Proceeding now with CICD run.\n\n<${run.config.application.docUri}|details>`);
                }).then(() => {

                    run.config.runId = run._id;// this indicates that there is already a run for this update set
                    return new EbQueueJob({ name: 'run', background: true, description: `Build UpdateSet ${run.config.updateSet.sys_id}` }, run.config).then(() => {
                        return res.json({
                            url: `/goto/run/${run._id}`
                        });
                    });

                });

            }).catch((e) => {
                console.error(e.message);
                return res.status(400).send(e.message);
            });

        });


        // get the status of the run job
        app.route('/run/:id').get((req, res) => {
            return res.json(eventBusServer.getJob(req.params.id));
        });

        /**
         * Only trigger the extraction of code from ServiceNow.
         * Same as run() but without the 'buildProject' step.
         */
        app.route('/export').post((req, res) => {
            return this.convertBuildBody(req.body).then((options) => {
                console.log("Start EXPORT");

                return self.db.us.findOne({
                    updateSetId: options.updateSet
                }).then((_us) => {
                    if (_us && _us.running)
                        //throw 'job already running';
                        throw Error('there is already a job running for this update-set');
                    if (_us && _us.pullRequestRaised)
                        throw Error('there is already a pending pull request for this update-set');

                    // check if the pr was reopened in the repo
                    return Promise.resolve().then(() => {
                        if (!_us || !_us.runId)
                            return;
                        const runId = _us.runId;
                        return self.db.run.get({ _id: runId }).then((run) => {
                            if (!run || !run.config)
                                return;

                            const config = run.config;
                            return self.pendingPullRequest({
                                config,
                                repoName: config.git.repository,
                                from: config.branchName
                            }).then((pending) => {
                                if (!pending)
                                    return;
                                // update status
                                _us.pullRequestRaised = true;
                                return self.db.us.update(_us).then(() => {
                                    throw Error('there is already a pending pull request for this update-set');
                                });
                            });
                        });
                    });
                }).then(() => {
                    return new EbQueueJob({ name: 'export', background: true, description: `Export UpdateSet ${options.updateSet}` }, options).then((result) => {
                        return res.json({
                            export: 'added-to-queue',
                            result,
                            status: `/export/${result.id}`
                        });
                    });
                });

            }).catch((e) => {
                console.error(e.message);
                return res.status(400).send(e.message);
            });
        });

        // get the status of the export job
        app.route('/export/:id').get((req, res) => {
            return res.json(eventBusServer.getJob(req.params.id));
        });


        /**
         * Proxy for Pull request service.
         * All updates on a pull request must be sent to this API.
         * In case of merge, it will start deployment.
         */
        app.route('/pull_request').post((req, res) => {
            console.log("/pull_request - pull request inbound %j", req.body);
            return self.pullRequest(req.body).then(() => {
                res.json({
                    pull: 'received'
                });
            }).catch((e) => {
                console.error(e.message);
                return res.status(400).send(e.message);
            });
        });

        server.listen(serverPort, () => {
            console.log('Server started on port', serverPort);
            self.emit('server-started', serverPort);
        });

    });
};
