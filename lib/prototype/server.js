require('dotenv').config();

const fs = require('fs');
const path = require("path");
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const https = require('https');
const Bluebird = require('bluebird');
const fileUpload = Bluebird.promisifyAll(require('express-fileupload'));
var mkdirp = Bluebird.promisifyAll(require('mkdirp'));
var extract = Bluebird.promisify(require('extract-zip'));
const uui = require('uuid/v4');
const ObjectAssignDeep = require('object-assign-deep');

const EventBusJob = require('../eb/job');

const httpPort = process.env.CICD_WEB_HTTP_PORT || 8080;
const certDir = path.join(__dirname, '../', '../', 'cert');
const webDir = path.resolve(__dirname, '../', '../', 'web');

const httpsPort = process.env.CICD_WEB_HTTPS_PORT;
const httpsKey = process.env.CICD_WEB_HTTPS_KEY || path.resolve(certDir, 'server-key.pem');
const httpsCert = process.env.CICD_WEB_HTTPS_CERT || path.resolve(certDir, 'server-crt.pem');
const httpsCa = (process.env.CICD_WEB_HTTPS_CA !== undefined) ? process.env.CICD_WEB_HTTPS_CA : path.resolve(certDir, 'server-ca-crt.pem');

const secure = (httpsPort !== undefined && httpsKey !== undefined && httpsCert !== undefined);


/**
 * Implements CICD.server()
 *
 */
module.exports = function () {
    const self = this;
    self.init(self.SERVER);

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
    app.use(fileUpload());

    const serverPort = secure ? httpsPort : httpPort;

    const server = (() => {
        if (secure) {
            // redirect 
            const redirect = express();
            redirect.enable('trust proxy');
            redirect.get('*', function (req, res) {
                res.redirect('https://' + req.headers.host.split(':')[0] + req.url);
            });
            redirect.listen(httpPort);
            console.log('Redirect Server started on port', httpPort);

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
    app.get('/jobs', function (req, res) {
        res.json(eventBusServer.getJobs());
    });
    app.get('/worker', function (req, res) {
        res.json(eventBusServer.getWorkerNodes());
    });

    app.get('/run', function (req, res) {
        self.run({
            updateSet: '766e8adadb249380ec77ff3bbf9619d4',
            application: {
                id: '3a3341e2db6607002bfcf3dcaf9619e5',
                name: "VA",
                git: {
                    repository: 'eam_test',
                    remoteUrl: null,//'ssh://git@git-ite.swissre.com:7999/snow/virtual_application.git',
                    pullRequestEnabled: true,
                    enabled: true
                }
            },
            host: {
                name: "https://swissre1.service-now.com",
                credentials: {
                    oauth: {
                        accessToken: "***REMOVED***",
                        refreshToken: null,
                        clientId: null,
                        clientSecret: null
                    }
                }
            },
            atf: {
                updateSetOnly: true,
                credentials: {
                    oauth: {
                        accessToken: "***REMOVED***"
                    }
                }
            },
            branch: {
                name: "master",
                host: {
                    name: "https://swissre1.service-now.com",
                    credentials: {
                        oauth: {
                            accessToken: "***REMOVED***",
                            refreshToken: null,
                            clientId: null,
                            clientSecret: null
                        }
                    }
                }
            }

        });
        res.send('ok');
    });

    app.get('/build_config/:id', (req, res) => {
        return self.db.us.find({
            commitId: req.params.id
        }).then((result) => {
            if (result && result.length)
                return res.json(result[0].build);
            res.json({});
        });
    });

    // have mochawesome running the ATF test from remote
    app.post('/run_test/', (req, res) => {

        const build = req.body;
        if (!build)
            return res.status(400).send('data is mandatory');

        const commitId = build.commitId;
        if (!commitId)
            return res.status(400).send('commitID is mandatory');

        return self.db.us.find({
            commitId: commitId
        }).then((result) => {
            if (result && result.length)
                return result[0];
            throw new Error('No Build found for this commitId', commitId);
        }).then((us) => {
            
            return new EventBusJob({
                    name: 'testProject',
                    host: us.buildOnHost
                }, {
                    config: ObjectAssignDeep({}, us.config, {
                        settings: self.settings
                    }),
                    id: us._id
                }).then(() => us);
        }).then((us) => {
            res.status(202).redirect(`run_test/${us._id}`); // job created, come back to url
        }).catch((e) => {
            return res.status(400).send(e.message);
        });
        
    });

    app.get('/run_test/:id', (req, res) => { 
        
        return self.db.us.get({ _id: req.params.id }).then((us) => {
            if (us.testJob == 'complete')
                return res.json(us.testResults);
        
            return res.status(304).redirect(`run_test/${us._id}`); // job running, wait and come back
        });
    });

    // have gulp posting the build results as ZIP
    app.post('/build_result/', (req, res) => {

        if (!req.body.data)
            return res.status(400).send('data is mandatory');
        
        const data = JSON.parse(req.body.data);
        
        const task = data.task;
        if (task === undefined)
            return res.status(400).send('task is mandatory');
        
        const testPass = data.testPass;
        if (testPass === undefined)
            return res.status(400).send('testPass is mandatory');
        
        const commitId = data.commitId;
        if (!commitId)
            return res.status(400).send('commitID is mandatory');
        
        if (!req.files || !req.files.zip)
            return res.status(400).send('No files were uploaded.');
        
        return self.db.us.find({
            commitId: commitId
        }).then((result) => {
            if (result && result.length)
                return result[0];
            throw new Error('No Build found for this commitId', commitId);
        }).then((us) => {
            const buildTask = us.build[task];
            if (!buildTask) {
                throw new Error(`Unknown build task ${task}`);
            }

            us.buildResults[task] = testPass;
            if (buildTask.breakOnError && !testPass)
                us.buildResult = false;
            
            return self.db.us.update(us).then(() => us);
            
        }).then((us) => {
            if (!req.files || !req.files.zip) {
                return res.send('No files were uploaded.');
            }
            
            return mkdirp.mkdirpAsync(us.config.application.dir.tmp).then(() => {
                const tempZip = path.join(us.config.application.dir.tmp, `${uui()}.zip`);
                return req.files.zip.mv(tempZip).then(() => tempZip);
            }).then((tempZip) => {
                //console.log(tempZip);
                return extract(tempZip, { dir: path.join(us.config.application.dir.doc, task) });
            }).then(() => {
                return res.send('File uploaded!');
            });
    
        }).catch((e) => {
            return res.status(400).send(e.message);
        });
    });

    // gulp complete
    app.post('/build_done/', (req, res) => {

        const build = req.body;
        if (!build)
            return res.status(400).send('data is mandatory');
        
        const commitId = build.commitId;
        if (!commitId)
            return res.status(400).send('commitID is mandatory');
        
        return self.db.us.find({
            commitId: commitId
        }).then((result) => {
            if (result && result.length)
                return result[0];
            throw new Error('No Build found for this commitId', commitId);
        }).then((us) => { 
            if (us.buildResult === false)
                return;
            
            const buildResult = Object.keys(us.buildResults).every((task) => {
                return (us.build[task].testPass === true);
            });
            us.buildResult = buildResult;
            return self.db.us.update(us);
        }).then(() => {
            res.send('Thanks');
        });
    });


    // web app
    app.use('/', express.static(webDir));

    app.use('/doc', express.static(path.resolve(self.settings.documentsRootDir)));

    app.route('/goto/:type/:us').get((req, res) => {
        if ('us' == req.params.type) {
            return this.db.us.get({
                _id: req.params.us
            }).then((result) => {
                if (result && result._id && result.app) {
                    if (result.lastSuccessfulRun) {
                        res.redirect(`/steps.html#/app/${result.app}/us/${result._id}/run/${result.lastSuccessfulRun._id}`);
                    } else {
                        res.redirect(`/runs.html#/app/${result.app}/us/${result._id}/`);
                    }
                } else {
                    res.redirect('/');
                }
            });
        }
        res.redirect('/');
    });

    app.route('/app').get((req, res) => {
        return this.db.application.find({}).then((result) => {
            result.sort((a, b) => {
                if (a.application.name < b.application.name) return -1;
                if (a.application.name > b.application.name) return 1;
                return 0;
            });
            res.json(result);
        });
    });
    app.route('/app/:id').get((req, res) => {
        return self.db.application.get({
            _id: req.params.id
        }).then((result) => {
            res.json(result);
        });
    });

    app.route('/app/:id/us').get((req, res) => {
        return this.db.us.find({
            app: req.params.id
        }).then((result) => {
            result = result.map((r) => {
                if (r.config.host) {
                    delete r.config.host.credentials;
                }
                if (r.config.branch) {
                    delete r.config.branch.host.credentials;
                }
                if (r.config.deploy) {
                    delete r.config.deploy.host.credentials;
                }
                return r;
            });
            res.json(result);
        });
    });

    app.route('/app/:id/us/:us').get((req, res) => {
        return this.db.us.get({
            _id: req.params.us
        }).then((result) => {
            if (result) {
                if (result.config.host) {
                    delete result.config.host.credentials;
                }
                if (result.config.branch) {
                    delete result.config.branch.host.credentials;
                }
                if (result.config.deploy) {
                    delete result.config.deploy.host.credentials;
                }
            }
            res.json(result);
        });
    });

    app.route('/app/:id/us/:us/run').get((req, res) => {
        return this.db.run.find({
            us: req.params.us
        }).then((result) => {
            result.sort((a, b) => {
                return (b.ts - a.ts);
            });
            res.json(result);
        });
    });

    app.route('/app/:id/us/:us/run/:run').get((req, res) => {
        return this.db.run.get({
            _id: req.params.run
        }).then((result) => {
            res.json(result);
        });
    });

    app.route('/app/:id/us/:us/run/:run/step').get((req, res) => {
        return this.db.step.find({
            run: req.params.run
        }).then((result) => {
            result.sort((a, b) => {
                return (b.ts - a.ts);
            });
            res.json(result);
        });
    });

    app.route('/app/:id/us/:us/run/:run/step/:step').get((req, res) => {
        return this.db.step.get({
            _id: req.params.step
        }).then((result) => {
            res.json(result);
        });
    });

    app.route('/us').get((req, res) => {
        return this.db.us.find({}).then((result) => {
            result = result.map((r) => {
                if (r.config.host) {
                    delete r.config.host.credentials;
                }
                if (r.config.branch) {
                    delete r.config.branch.host.credentials;
                }
                if (r.config.deploy) {
                    delete r.config.deploy.host.credentials;
                }
                return r;
            });
            res.json(result);
        });
    });
    app.route('/us/:id').get((req, res) => {
        return this.db.us.get({
            _id: req.params.id
        }).then((result) => {
            if (result) {
                if (result.config.host) {
                    delete result.config.host.credentials;
                }
                if (result.config.branch) {
                    delete result.config.branch.host.credentials;
                }
                if (result.config.deploy) {
                    delete result.config.deploy.host.credentials;
                }
            }
            res.json(result);
        });
    });


    app.route('/run').get((req, res) => {
        return this.db.run.find({}).then((result) => {
            result.sort((a, b) => {
                return (b.ts - a.ts);
            });
            res.json(result);
        });
    });
    app.route('/us/:id').get((req, res) => {
        return this.db.run.get({
            _id: req.params.id
        }).then((result) => {
            res.json(result);
        });
    });

    app.route('/build')
        .post((req, res) => {

            return this.convertBuildBody(req.body).then((options) => {
                console.log("start CI/CI");
                console.dir(options, {
                    depth: null,
                    colors: true
                });
                // dont return here and wait for the export to be done ...
                this.buildUpdateSetOnBranch(options);

                res.json({
                    job: 'started'
                });
            });
        });

    app.route('/pull_request')
        .post((req, res) => {

            return this.convertPullBody(req.body).then((body) => {
                console.log("pull request inbound");
                //console.dir(body, { depth: null });

                try {
                    // dont return here and wait for the deployment to be done ...
                    this.gitPullRequestUpdate(body);
                } catch (e) {
                    // we want to see the error 
                    console.error(e);
                    throw e;
                }

                res.json({
                    pull: 'received'
                });
            });

        });

    server.listen(serverPort, () => {
        console.log('Server started on port', serverPort);
    });
};