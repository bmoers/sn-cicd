const fs = require('fs-extra');
const path = require("path");
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const https = require('https');

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

    console.log(`Version: ${require('../../package.json').version}\n${'* '.repeat(70)}\n${
        figlet.textSync('CICD SERVER', { font: 'Larry 3D', horizontalLayout: 'full', verticalLayout: 'default' })
        }\n${'* '.repeat(70)}`);

    const self = this;

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

    }).then(() => {

        const eventBusServer = require('../eb/server').call(self);

        // TODO: start one worker thread in server mode
        //this.worker(1);

        const app = express();

        app.use((req, res, next) => {
            bodyParser.json({
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
            extended: true
        }));

        const server = (() => {
            if (secure) {
                // redirect 
                const redirect = express();
                redirect.enable('trust proxy');
                redirect.get('*', function (req, res) {
                    const target = `https://${req.headers.host.split(':')[0]}:${process.env.CICD_WEB_HTTPS_PORT}${req.url}`;
                    console.log("redirect to", target)
                    res.redirect(target);
                });
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

        app.use('/source', require('./server/source').call(self));

        // web app
        app.use('/', express.static(webDir));

        // generated documents
        app.use('/doc', express.static(path.resolve(self.settings.documentsRootDir)));

        // short links 
        app.route('/goto/:type/:id').get((req, res) => {
            if ('us' == req.params.type) {
                return this.db.us.find({
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
                return this.db.run.get(req.params.id).then((run) => {
                    if (!run)
                        return res.redirect('/');

                    if (run.appId && run.usId) {
                        res.redirect(`/steps/#/app/${run.appId}/us/${run.usId}/run/${run._id}`);
                    } else {
                        res.redirect('/');
                    }

                });
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
                console.log("Start CI/CD");

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
            console.log("Pull request inbound %j", req.body);
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