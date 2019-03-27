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

const promiseFor = Promise.method((condition, action, value) => {
    if (!condition(value))
        return value;
    return action(value).then(promiseFor.bind(null, condition, action));
});

const detached = false
let server;
let commitId;

const jobName = path.basename(__filename).split('.')[0];
describe(jobName, function () {

    before(function (done) {
        this.timeout(0);
        Promise.try(() => {
            const chalk = require('chalk');

            const spawn = require('child_process').spawn;
            server = spawn('npm.cmd', ['run-script', 'server'], {
                cwd: process.cwd(),
                detached
            });
            server.stderr.on('data', (data) => {
                console.error(chalk.red(`${data}`));
            });
            server.stdout.on('data', (data) => {
                console.log(chalk.blue(`${data}`));
            });


        }).delay(process.env.M00_START_DELAY).then(() => {
            const db = {
                run: null
            };

            const Datastore = require('nedb');
            const path = require("path");

            Object.keys(db).forEach((collection) => {
                const coll = new Datastore({
                    filename: path.join(process.cwd(), 'db', `${collection}.db`),
                    autoload: true
                });
                Promise.promisifyAll(coll);
                db[collection] = coll;
            });

            return db.run.findOneAsync({
                sequence: 1
            }).then((run) => {
                if (!run)
                    throw Error('Cant run, no run found');

                commitId = run.commitId;
                //dir = run.dir.code;

            }).then(() => {
                done();
            })

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
            }, 10000);
        } else {
            done();
        }
    });

    describe('execute test()', function () {
        let testResponse;

        this.timeout(0);
        it(`${jobName} - job must be added to queue`, function () {
            return rp({
                followRedirect: false,
                strictSSL: false,
                method: 'POST',
                url: `${HOST}/build/test`,
                json: true,
                headers: { 'x-access-token': process.env.CICD_BUILD_ACCESS_TOKEN },
                body: {
                    commitId: commitId,
                    //on: process.env.M2_CICD_DEPLOY
                },
                resolveWithFullResponse: true
            }).then((response) => {
                testResponse = response.headers.location;
                console.log('1 testResponse', testResponse)
                assert.equal(response.statusCode, 202);
            }).catch((e) => {
                console.log(e.error);
                console.log(e.message)
                assert.equal(e, null);

            })
        });

        it(`${jobName} - job completed`, function () {

            const rpd = rp.defaults({
                json: true,
                baseUrl: HOST,
                gzip: true,
                strictSSL: false,
                proxy: false,
                encoding: "utf8",
                headers: {
                    'x-access-token': process.env.CICD_BUILD_ACCESS_TOKEN
                }
            });

            const WAIT_DELAY_MS = 2000;
            let body;
            return promiseFor(function (nextOptions) {
                return (nextOptions);
            }, (options) => {

                return rpd(options)
                    .then((response) => {
                        let location;
                        if (response.statusCode === 202) { // job created, come back to url
                            location = response.headers.location;
                            if (!location)
                                throw Error('Location header not found');

                            delete options.body;
                            options.method = 'GET';
                            options.url = location;

                            return options;
                        }

                        options = null;
                        body = response.body;
                    }).catch((e) => {
                        let location;
                        if (e.statusCode === 304) { // job still running, wait and follow location
                            location = e.response.headers.location;
                            if (!location)
                                throw e;

                            delete options.body;
                            options.method = 'GET';
                            options.url = location;

                            console.log(`Job in progress. Wait for ${WAIT_DELAY_MS} ms ...`);
                            return Promise.delay(WAIT_DELAY_MS).then(() => {
                                return options;
                            });
                        } else {
                            throw e;
                        }
                    });
            }, {
                    followRedirect: false,
                    strictSSL: false,
                    method: 'GET',
                    url: `${testResponse}`,
                    json: true,
                    resolveWithFullResponse: true,
                    headers: { 'x-access-token': process.env.CICD_BUILD_ACCESS_TOKEN },
                }
            ).then(() => {
                console.log('response body', body);
                assert.equal(body.state, "complete");
            });
        });

    });

});