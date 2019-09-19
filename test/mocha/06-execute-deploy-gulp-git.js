const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config();

const mocha = require('mocha');
const describe = mocha.describe;
const it = mocha.it;
const before = mocha.before;
const after = mocha.after;

var assert = require('assert');
var Promise = require('bluebird');


const promiseFor = Promise.method((condition, action, value) => {
    if (!condition(value))
        return value;
    return action(value).then(promiseFor.bind(null, condition, action));
});

const detached = false;
let server;
let commitId;
let dir;
const jobName = path.basename(__filename).split('.')[0];
describe(jobName, function() {

    before(function(done) {
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
                dir = run.dir.code;

            }).delay(9000000).then(() => {

                done();
            })
        });
    });

    after(function(done) {
        if (detached)
            return done();
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


    describe('execute install()', function() {

        this.timeout(0);
        it(`${jobName} - npm dependencies do install`, function(done) {
            const chalk = require('chalk');

            console.log('run install in ', dir);

            const spawn = require('child_process').spawn;
            const child = spawn('npm.cmd', ['install'], {
                cwd: dir,
                detached
            });
            let err = '';
            child.stderr.on('data', (data) => {
                const line = data.toString().replace(/\n+/, '\n');
                err += line;
                console.error(chalk.yellow(`INSTALL: ${line}`));
            });
            child.stdout.on('data', (data) => {
                console.log(chalk.magenta(`INSTALL: ${data.toString().replace(/\n+/, '\n')}`));
            });
            child.on('exit', function(c) {
                if (c)
                    return assert.equal(err, null, err);

                done();
            });
        });

    });

    describe('execute deliver()', function() {

        this.timeout(0);
        it(`${jobName} - deliver to ${process.env.M2_CICD_DEPLOY}`, function(done) {
            const chalk = require('chalk');
            const spawn = require('child_process').spawn;
            const child = spawn('.\\node_modules\\.bin\\gulp.cmd', ['deploy', '--git', true, '--deliver-to', process.env.M2_CICD_DEPLOY, '--commit-id', commitId], {
                cwd: dir,
                detached,
                env: {
                    CICD_GULP_HOST_FQDN: process.env.CICD_GULP_HOST_FQDN || '',
                    CICD_WEB_HTTPS_PORT: process.env.CICD_WEB_HTTPS_PORT || '',
                    CICD_WEB_HTTP_PORT: process.env.CICD_WEB_HTTP_PORT || '',
                    CICD_WEB_HOST_NAME: process.env.CICD_WEB_HOST_NAME || '',

                    CICD_DELIVER_FROM: process.env.M2_CICD_SOURCE,
                    CICD_DEPLOY_ACCESS_TOKEN: process.env.CICD_DEPLOY_ACCESS_TOKEN
                }
            });
            let err = '';
            child.stderr.on('data', (data) => {
                const line = data.toString().replace(/\n+/, '\n');
                err += line;
                console.error(chalk.yellow(`GULP: ${line}`));
            });
            child.stdout.on('data', (data) => {
                console.log(chalk.magenta(`GULP: ${data.toString().replace(/\n+/, '\n')}`));
            });
            child.on('exit', function(c) {
                if (c && err)
                    return assert.equal(err, null, err);

                setTimeout(() => {
                    done();
                }, 30000);
            });
        });

    });


    describe('execute deploy()', function() {

        this.timeout(0);
        it(`${jobName} - deploy to ${process.env.M2_CICD_DEPLOY}`, function(done) {
            const chalk = require('chalk');
            const spawn = require('child_process').spawn;
            const child = spawn('.\\node_modules\\.bin\\gulp.cmd', ['deploy', '--git', true, '--deploy-to', process.env.M2_CICD_DEPLOY, '--commit-id', commitId], {
                cwd: dir,
                detached,
                env: {
                    CICD_GULP_HOST_FQDN: process.env.CICD_GULP_HOST_FQDN || '',
                    CICD_WEB_HTTPS_PORT: process.env.CICD_WEB_HTTPS_PORT || '',
                    CICD_WEB_HTTP_PORT: process.env.CICD_WEB_HTTP_PORT || '',
                    CICD_WEB_HOST_NAME: process.env.CICD_WEB_HOST_NAME || '',

                    CICD_DEPLOY_FROM: process.env.M2_CICD_SOURCE,
                    CICD_DEPLOY_ACCESS_TOKEN: process.env.CICD_DEPLOY_ACCESS_TOKEN
                }
            });
            let err = '';
            child.stderr.on('data', (data) => {
                const line = data.toString().replace(/\n+/, '\n');
                err += line;
                console.error(chalk.yellow(`GULP: ${line}`));
            });
            child.stdout.on('data', (data) => {
                console.log(chalk.magenta(`GULP: ${data.toString().replace(/\n+/, '\n')}`));
            });
            child.on('exit', function(c) {
                if (c && err)
                    return assert.equal(err, null, err);

                setTimeout(() => {
                    done();
                }, 30000);
            });
        });

    });


});