require('dotenv').config();

const fs = require('fs-extra');
const path = require("path");
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const https = require('https');

const httpPort = process.env.CICD_WEB_HTTP_PORT || 8080;
const certDir = path.join(__dirname, '../', '../', 'cert');
const webDir = path.resolve(__dirname, '../', '../', 'web');

const httpsPort = process.env.CICD_WEB_HTTPS_PORT;
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

    console.log('\n' + '* '.repeat(70) + '\n' + figlet.textSync('CICD SERVER', {
        font: 'Larry 3D',
        horizontalLayout: 'full',
        verticalLayout: 'default'
    }) + '\n' + '* '.repeat(70));

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
                    remoteUrl: null, //'ssh://git@git-ite.swissre.com:7999/snow/virtual_application.git',
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


    app.use('/build', require('./server/build').call(self));
    app.use('/dao', require('./server/dao').call(self));

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


    app.route('/build')
        .post((req, res) => {

            return this.convertBuildBody(req.body).then((options) => {
                console.log("start CI/CI");
                console.dir(options, {
                    depth: null,
                    colors: true
                });
                // dont return here and wait for the export to be done ...
                self.run(options);

                res.json({
                    job: 'started'
                });
            });
        });

    app.route('/pull_request')
        .post((req, res) => {

            try {
                // dont return here and wait for the deployment to be done ...
                self.gitPullRequestProxy(req.body);
            } catch (e) {
                // we want to see the error 
                console.error(e);
                throw e;
            }

            res.json({
                pull: 'received'
            });

        });

    server.listen(serverPort, () => {
        console.log('Server started on port', serverPort);
    });
};