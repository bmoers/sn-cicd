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

const fs = require('fs-extra');

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
            const path = require('path');
            return fs.emptydir(path.join(process.cwd(), 'db'));
        }).then(() => {

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
            done();
        });
    });

    after(function (done) {
        if (server && server.pid) {
            this.timeout(0);
            setTimeout(() => {
                //console.log("Stop the server now");
                var kill = require('tree-kill');
                kill(server.pid, () => {
                    done();
                });
            }, 200);
        } else {
            done();
        }
    });

    describe('server is online', function () {

        it('connect to web ui', function () {
            return rp({
                followRedirect: false,
                strictSSL: false,
                method: 'GET',
                url: `${HOST}`,
                json: false
            }).then(() => {
                assert.equal('running', 'running');
            }).catch((e) => {
                console.log(e.error);
                console.log(e.message);
                assert.equal(e.error, null);

            });

        });

    });

});
