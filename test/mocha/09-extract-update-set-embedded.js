const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config();


const httpPort = process.env.CICD_WEB_HTTP_PORT || 8080;
const httpsPort = process.env.CICD_WEB_HTTPS_PORT;
const secure = (httpsPort !== undefined);
const serverPort = secure ? httpsPort : httpPort;
const HOST = `http${secure ? 's' : ''}://${process.env.CICD_EB_HOST_NAME}:${serverPort}`;


const mocha = require('mocha');
const describe = mocha.describe;
const it = mocha.it;
const before = mocha.before;
const after = mocha.after;

var assert = require('assert');
var Promise = require('bluebird');
const rp = require('request-promise');
const assign = require('object-assign-deep');

const promiseFor = Promise.method((condition, action, value) => {
    if (!condition(value))
        return value;
    return action(value).then(promiseFor.bind(null, condition, action));
});


let server;
const detached = false;
describe(path.basename(__filename).split('.')[0], function () {

    before(function (done) {
        this.timeout(0);
        Promise.try(() => {
            const chalk = require('chalk');

            const spawn = require('child_process').spawn;
            server = spawn('npm.cmd', ['run-script', 'server'], {
                cwd: process.cwd(),
                detached,
                env: assign({}, process.env, { CICD_EMBEDDED_BUILD: 'true' })
            });
            server.stderr.on('data', (data) => {
                console.error(chalk.red(`${data}`));
            });
            server.stdout.on('data', (data) => {
                console.log(chalk.blue(`${data}`));
            });

        }).delay(process.env.M00_START_DELAY).then(() => {
            done();
        });
    });

    after(function (done) {
        if (detached)
            return done();
        if (server && server.pid) {
            this.timeout(0);
            setTimeout(() => {
                var kill = require('tree-kill');
                kill(server.pid, () => {
                    done();
                });
            }, 20000);
        } else {
            done();
        }
    });

    describe('execute run()', function () {
        let exeResponse;
        let queueResponse;
        let completeResponse;
        this.timeout(0);
        it(`job must be added to queue ${HOST}`, function () {
            return rp({
                followRedirect: false,
                strictSSL: false,
                method: 'POST',
                url: `${HOST}/run`,
                json: true,
                body: {
                    build: {
                        'requestor': {
                            'userName': 'Boris.Moers',
                            'fullName': 'Boris Moers',
                            'email': process.env.M02_CICD_EMAIL
                        }
                    },
                    'atf': {
                        'name': process.env.CICD_ATF_TEST_USER_NAME,
                        'updateSetOnly': false
                    },
                    'updateSet': process.env.M02_CICD_TEST_US_ID,
                    'application': {
                        'id': process.env.M02_CICD_TEST_APP_ID,
                        'name': process.env.M02_CICD_TEST_APP_NAME
                    },
                    'git': {
                        'repository': process.env.M2_CICD_TEST_REPO
                    },
                    'host': {
                        'name': process.env.M2_CICD_SOURCE
                    },
                    _master: {
                        name: 'master',
                        host: {
                            name: process.env.M2_CICD_MASTER
                        },
                        enabled: undefined
                    },
                    __deploy: {
                        host: {
                            name: process.env.M2_CICD_DEPLOY
                        }
                    }
                }
            }).then((result) => {
                return Promise.delay(10000).then(() => result);
            }).then((result) => {
                //console.log("run() result", result);
                exeResponse = result;
                assert.equal(exeResponse.run, 'added-to-queue');
            }).catch((e) => {
                console.error(e);
                throw e;
            });
        });

        it('job must be in to queue', function () {
            rp({
                followRedirect: false,
                strictSSL: false,
                method: 'GET',
                url: `${HOST}${exeResponse.status}`,
                json: true
            }).then((result) => {
                return Promise.delay(1000).then(() => result);
            }).then((result) => {
                queueResponse = result;
                //console.log('job must be in to queue', result);
                assert.equal(queueResponse.status, 'background-in-progress');
            }).catch((e) => {
                console.error(e);
                throw e;
            });
        });

        it('job completed', function () {

            const WAIT_DELAY_MS = 2000;

            return promiseFor(function (nextOptions) {
                return (nextOptions);
            }, (options) => {
                //console.log('Request: ', options);

                // create a new copy of the defaults client
                return rp(options).then((result) => {
                    //console.log('job completed', result);
                    if (result.status == 'background-in-progress') {
                        console.log('Wait', WAIT_DELAY_MS);
                        return Promise.delay(WAIT_DELAY_MS).then(() => {
                            return options;
                        });
                    } else {
                        completeResponse = result;
                        return null;
                    }
                });
            }, {
                followRedirect: false,
                strictSSL: false,
                method: 'GET',
                url: `${HOST}${exeResponse.status}`,
                json: true
            }
            ).then(() => {
                assert.equal(completeResponse.status, 'complete');
            }).catch((e) => {
                console.error(e);
                throw e;
            });
        });

    });

});