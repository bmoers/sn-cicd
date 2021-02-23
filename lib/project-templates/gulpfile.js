/* eslint-disable func-names */
/* eslint-disable func-name-matching */
/*eslint complexity: ["off", 24]*/
/*


Environment Variables used during deployment.
Variables can be defined in .env or set in the process context

CICD Server
    process.env.CICD_GULP_HOST_FQDN // https://server:4444
OR
    process.env.CICD_WEB_HTTPS_PORT // number or undefined
    process.env.CICD_WEB_HTTP_PORT  // number or undefined
    process.env.CICD_WEB_HOST_NAME  // server.company.com

Access token
    process.env.CICD_BUILD_ACCESS_TOKEN


CommitID 
    process.env.CICD_COMMIT_ID

ATF 
    process.env.CICD_RUN_TEST_ON_HOST       // the host on which to test

Deployment
    process.env.CICD_CD_DEPLOY_FROM_GIT     // deploy update set from git instead from a service now source environment
    process.env.CICD_DEPLOY_FROM            // optional
    process.env.CICD_DEPLOY_TO              // the target to deploy

    process.env.CICD_DELIVER_FROM           // optional
    process.env.CICD_DELIVER_TO             // the target to deliver

DEPLOY wins if CICD_DEPLOY_TO and CICD_DELIVER_TO are set

! WARNING !
if process.env.CICD_CD_STRICT_DEPLOYMENT is set to true on the CICD server, deployment target will be only taken from the server configuration.
look for 'CICD_CD_DEPLOYMENT_TARGET_ vars in .env

*/

require('dotenv').config();

// fix to run on node below v12
const semver = require('semver');
if (semver.lt(process.version, '12.0.0') && !global.globalThis) {
    global.globalThis = global;
}

const Promise = require('bluebird');
const { dest, parallel, series, src } = require("gulp");

var del = require('del');
const gulpZip = require('gulp-zip');

const jsdoc3 = require('gulp-jsdoc3');
const mocha = require('gulp-mocha');
const eslint = require('gulp-eslint');
const rename = require('gulp-rename');

const reporter = require('eslint-detailed-reporter');
const path = require('path');
const fs = require('fs-extra');
const archiver = require('archiver');

const { v4: uuidv4 } = require('uuid');
const rp = require('request-promise');

const port = process.env.CICD_WEB_HTTPS_PORT || process.env.CICD_WEB_HTTP_PORT;
const cicdServerFqdn = process.env.CICD_GULP_HOST_FQDN || ((process.env.CICD_WEB_HOST_NAME) ? `${(process.env.CICD_WEB_HTTPS_PORT) ? 'https' : 'http'}://${process.env.CICD_WEB_HOST_NAME}:${port}` : null);

const Git = require('sn-project/lib/git');

//const { resolveFormatter } = require('gulp-eslint/util');

const ROUTE_GULP_COMPLETE = '/build/complete';
const ROUTE_TASK_COMPLETE = '/build/task';
const ROUTE_BUILD_CONFIG = '/build/config';
const ROUTE_RUN_DEPLOY = '/deploy/us';

const arg = ((argList) => {
    const arg = {};
    let opt, curOpt;
    argList.forEach((thisOpt) => {
        thisOpt = (thisOpt) ? thisOpt.trim() : thisOpt;
        opt = thisOpt.replace(/^\-+/, '');
        if (opt === thisOpt) {
            if (curOpt)
                arg[curOpt] = opt;
            curOpt = null;
        } else {
            curOpt = opt;
            arg[curOpt] = true;
        }
    });
    return arg;

})(process.argv);

/**
 * Loop 'action' as long 'condition' over 'value' is true
 */
const promiseFor = Promise.method(function (condition, action, value) {
    if (!condition(value))
        return value;
    return action(value).then(promiseFor.bind(null, condition, action));
});


const git = new Git({
    dir: path.resolve(__dirname)
});

const rpd = rp.defaults({
    json: true,
    baseUrl: cicdServerFqdn,
    gzip: true,
    strictSSL: false,
    proxy: false,
    encoding: "utf8",
    headers: {
        'x-access-token': process.env.CICD_BUILD_ACCESS_TOKEN
    }
});


/**
 * Bundle task result as zip file and send it to the CICD server
 * 
 * @async
 * @param {Object} stepConfig 
 */
const taskStop = async (stepConfig) => {

    try {
        const task = stepConfig.task;
        console.log(`### Task Ended '${task}'`);
        //console.log('%j', stepConfig);

        if (!stepConfig.testPass)
            console.warn(`WARN: Gulp failed on task '${task}'. Type: '${stepConfig.taskError.name}', Message: '${stepConfig.taskError.message}'`);

        const zipFile = await zip(stepConfig);
        await uploadResults({
            zip: fs.createReadStream(zipFile),
            commitId: stepConfig.commitId,
            task: stepConfig.task,
            testPass: stepConfig.testPass
        });

        console.log(`Remove file '${zipFile}'`);
        await fs.remove(zipFile);

        console.log(`Remove directory '${stepConfig.dir}'`);
        await fs.remove(stepConfig.dir);

    } catch (e) {
        console.error(e.message, e);
    }

};

/**
 * Upload the ZUip file to the CICD server
 * 
 * @async
 * @param {*} obj
 * @param {string} obj.commitId - current commit id
 * @param {string} obj.zip  - zip file path
 * @param {string} obj.task - name of the task
 * @param {boolean} obj.testPass - test pass information
 */
const uploadResults = async ({ commitId, zip, task, testPass }) => {
    
    const data = JSON.stringify({
        commitId,
        task,
        testPass
    });

    console.log("Upload Test Results: ", data);

    const results = await rpd.post({
        url: ROUTE_TASK_COMPLETE,
        formData: {
            zip,
            data
        }
    });

    console.log("Upload Results for task:", task, 'Upload successful!  Server responded with:', results);
};

/**
 * Zip the directory
 * 
 * @param {*} obj
 * @param {string} obj.dir - base dir to zip
 * @param {string} obj.task - name of the task
 */
const zip = ({ dir, task }) => {

    return new Promise((resolve, reject) => {
        if (!dir)
            reject(`Gulp task '${task}' has no directory`);

        const output = fs.createWriteStream(path.join(dir, '../', `${task}.zip`));
        output.on('close', function () {
            console.log("ZIP:", task, archive.pointer() + ' total bytes');
            console.log("ZIP:", task, 'archiver has been finalized and the output file descriptor has closed.');
            resolve(path.join(dir, '../', `${task}.zip`));
        });

        const archive = archiver('zip', {
            zlib: {
                level: 9
            }
        });
        archive.pipe(output);

        console.log("ZIP:", task, "adding folder ", dir);

        archive.directory(dir, false);
        archive.finalize();
    });

};

/**
 * Get the commit ID either from the CICD_COMMIT_ID env or 
 * from the HEAD of the current branch
 * 
 * @async
 * @return {Promise<string>} the commit ID
 */
const getCommitId = async () => {

    if (process.env.CICD_COMMIT_ID !== undefined)
        return process.env.CICD_COMMIT_ID;

    const initialized = await git.initialized();
    if (!initialized) {
        throw Error("Commit ID not found. This seems not to be a git repository.");
    }

    return git.getLastCommitId();

}

/**
 * Default build action.
 * 
 * The tasks to run (lint, doc, test) and its configuration are 
 * requested from the CICD server on the /build/config API
 *  
 * @async
 * @returns {Promise}
 */
const build = async function () {

    const commitId = await getCommitId();
    console.log('Processing commitId: ', commitId);

    const config = await rpd.get(`${ROUTE_BUILD_CONFIG}/${commitId}`);

    const tempDir = require('os').tmpdir();
    const uuid = uuidv4();
    const parallelSteps = [];

    config.tempDir = path.join(tempDir, uuid);
    config.lint.dir = path.join(tempDir, uuid, 'lint');
    config.doc.dir = path.join(tempDir, uuid, 'doc');
    config.test.dir = path.join(tempDir, uuid, 'test');

    const geStepConfig = (taskName) => {
        const stepConfig = config[taskName];
        stepConfig.commitId = commitId;
        stepConfig.task = taskName;
        stepConfig.testPass = undefined;
        return stepConfig;
    }


    const init = async function init() {
        if (!config.init)
            throw Error(`Build config not complete: ${config}`);

        console.log("######################  Init  ######################");
        await Promise.all([
            fs.mkdirp(config.doc.dir),
            fs.mkdirp(config.lint.dir),
            fs.mkdirp(config.test.dir)
        ]);

    };

    const buildDone = async function buildDone() {
        console.log("######################  BuildDone  ######################");
        //console.log('build results %j', config);

        config.commitId = commitId;
        const results = await rpd.post({
            url: ROUTE_GULP_COMPLETE, body: config
        });

        console.log('Build Done:', results);
    };


    if (config.doc && config.doc.enabled !== false) {

        const stepConfig = geStepConfig('doc');

        const task = function doc() {

            console.log("######################  JsDoc  ######################");

            stepConfig.config.opts.destination = stepConfig.dir;
            
            //console.log('JsDoc to destination:', stepConfig.config.opts.destination);

            return src(['README.md*', './sn/**/*.js', './sn/**/*.jsdoc'], {
                read: false
            })
            .pipe(jsdoc3(stepConfig.config))
            .on('error', function (e) {
                stepConfig.testPass = false;
                stepConfig.taskError = e;
                this.emit('end');
            })
            .on("end", function () {
                stepConfig.testPass = stepConfig.testPass == undefined ? true : stepConfig.testPass;
            });
        };

        parallelSteps.push(series(task, function docDone() {
            return taskStop(stepConfig)
        }));
    }


    if (config.lint && config.lint.enabled !== false) {

        if(config.lint.config.envs){
            // 'angular' is not a valid environment
            config.lint.config.envs = config.lint.config.envs.filter((e) => e !== 'angular')
        }

        //const debug = require('gulp-debug');

        const stepConfig = geStepConfig('lint');

        const task = function lint() {

            console.log("######################  EsLint  ######################");

            const esLintReport = path.resolve(stepConfig.dir, 'index.html');
            const lintFiles = stepConfig.files.concat('!node_modules/**');

            //console.log('EsLint to destination:', esLintReport);
            //console.log('EsLint on files:', lintFiles);

            return src(lintFiles, { debug: false })
                //.pipe(debug())
                .pipe(eslint(stepConfig.config))
                .pipe(eslint.format(reporter, function (results) {
                    console.log('write EsLint results to destination:', esLintReport);
                    fs.writeFileSync(esLintReport, results);
                }))
                .pipe(eslint.failAfterError())
                .on('error', function (e) {
                    stepConfig.testPass = false;
                    stepConfig.taskError = e;
                    this.emit('end');
                }).on("end", function () {
                    stepConfig.testPass = stepConfig.testPass == undefined ? true : stepConfig.testPass;
                });

        };

        parallelSteps.push(series(task, function lintDone() {
            return taskStop(stepConfig)
        }));
    }



    if (config.test && config.test.enabled !== false) {

        const stepConfig = geStepConfig('test');

        const task = function test() {

            console.log("######################  Mocha  ######################");

            return src(['test/*.js'], {
                read: false
            }).pipe(mocha({
                reporter: 'mochawesome', // 'xunit' 'spec'
                reporterOptions: {
                    reportDir: config.test.dir,
                    reportFilename: 'index.html',
                    reportTitle: config.test.title,
                    reportPageTitle: 'ATF Results',
                    quiet: true,
                    json: true,
                    inline: false,
                    code: false
                },
                timeout: 30000,
                delay: true
            }))
                .on('error', function (e) {
                    stepConfig.testPass = false;
                    stepConfig.taskError = e;
                    this.emit('end');
                })
                .on("end", function () {
                    stepConfig.testPass = stepConfig.testPass == undefined ? true : stepConfig.testPass;
                });


        };

        parallelSteps.push(series(task, function testDone() {
            return taskStop(stepConfig)
        }));

    }

    return new Promise((resolve) => {
        series(init, parallel(...parallelSteps), buildDone, async () => {
            await resolve()
        })();
    })
    

}

/**
 * from a standard build tool run 'gulp test' to only run the test 
 * this task requires the following args or environment variables to be in place
 *      --commit-id OR process.env.CICD_COMMIT_ID
 *      --on-host OR process.env.CICD_RUN_TEST_ON_HOST
 */
const test = () => {

    if (arg['on-host'])
        process.env.CICD_RUN_TEST_ON_HOST = arg['on-host'];

    if (arg['commit-id'])
        process.env.CICD_COMMIT_ID = arg['commit-id'];

    if (!process.env.CICD_COMMIT_ID)
        throw Error('CICD_COMMIT_ID is required');

    if (!cicdServerFqdn)
        throw Error('CICD Server endpoint not set. Use CICD_GULP_HOST_FQDN or CICD_WEB_HTTP(S)_PORT and CICD_WEB_HOST_NAME env variables');

    console.log(`Gulp Task [TEST] - commit-id: ${process.env.CICD_COMMIT_ID}; on-host: ${process.env.CICD_RUN_TEST_ON_HOST}`)

    return src(['test/*.js'], {
        read: false
    }).pipe(mocha({
        reporter: 'xunit',
        reporterOptions: {
            output: 'test-results.xml'
        },
        timeout: 30000,
        delay: true
    }));

}

const testApp = () => {

    if (arg['on-host'])
        process.env.CICD_RUN_TEST_ON_HOST = arg['on-host'];

    if (arg['suites'])
        process.env.CICD_RUN_SUITES = arg['suites'];
    if (arg['tests'])
        process.env.CICD_RUN_TESTS = arg['tests'];

    
    if (!process.env.CICD_RUN_SUITES && !process.env.CICD_RUN_TESTS)
        throw Error('suites or tests is required');

    if (!cicdServerFqdn)
        throw Error('CICD Server endpoint not set. Use CICD_GULP_HOST_FQDN or CICD_WEB_HTTP(S)_PORT and CICD_WEB_HOST_NAME env variables');

    console.log(`Gulp Task [TEST-APP] - suites: ${process.env.CICD_RUN_SUITES}; tests: ${process.env.CICD_RUN_TESTS}; on-host: ${process.env.CICD_RUN_TEST_ON_HOST}`)

    return src(['test/*.js'], {
        read: false
    }).pipe(mocha({
        reporter: 'xunit',
        reporterOptions: {
            output: 'test-results.xml'
        },
        timeout: 30000,
        delay: true
    }));

}

/**
 * Deploy or deliver a change to a target environment
 * If GIT is enabled the updateset is constructed as a delta based on the last 
 * deployment (commitID) on the target environment.
 * 
 * 
 * @async
 */
const deploy = async () => {
    try {

        const commitId = arg['commit-id'] || process.env.CICD_COMMIT_ID;
        if (!commitId)
            throw Error('CICD_COMMIT_ID is required');

        const git = arg['git'] || Boolean(process.env.CICD_CD_DEPLOY_FROM_GIT === 'true');
        const silent = arg['silent'];
        const deploy = Boolean(arg['deploy-to'] || process.env.CICD_DEPLOY_TO);
        const deliver = Boolean(arg['deliver-to'] || process.env.CICD_DELIVER_TO)

        const from = deploy ? arg['deploy-from'] || process.env.CICD_DEPLOY_FROM : arg['deliver-from'] || process.env.CICD_DELIVER_FROM;
        const to = deploy ? arg['deploy-to'] || process.env.CICD_DEPLOY_TO : arg['deliver-to'] || process.env.CICD_DELIVER_TO;


        if (!deploy && !deliver)
            throw Error('--deploy-to, CICD_DEPLOY_TO and --deliver-to, CICD_DELIVER_TO found');

        if (!cicdServerFqdn)
            throw Error('CICD Server endpoint not set. Use CICD_GULP_HOST_FQDN or CICD_WEB_HTTP(S)_PORT and CICD_WEB_HOST_NAME env variables');

        if (!silent)
            console.log(`Gulp Task [DEPLOY] - commit-id: ${commitId}; via-git: ${git}, from: ${from}; to: ${to}`);

        const sleepMs = 5000;
        let body = {};

        if (!process.env.CICD_DEPLOY_ACCESS_TOKEN)
            throw Error('CICD_DEPLOY_ACCESS_TOKEN env not set');

        const client = rpd.defaults({
            resolveWithFullResponse: true,
            followRedirect: false,
            headers: {
                'x-access-token': process.env.CICD_DEPLOY_ACCESS_TOKEN,
            }
        });

        await promiseFor(
            (options) => (options),
            async (options) => {
                try {
                    const response = await client(options)
                    
                    if (response.statusCode === 202) { // job created, come back to url
                        const location = response.headers.location;
                        if (!location)
                            throw Error('Location header not found');

                        delete options.body;
                        options.method = 'GET';
                        options.url = location;

                        // give it some time to start
                        await Promise.delay(sleepMs);
                        return options;
                    }

                    options = null;
                    body = response.body;

                } catch (e) {
                    if (e.statusCode !== 304)
                        throw e;

                    // job still running, wait and follow location
                    const location = e.response.headers.location;
                    if (!location)
                        throw e;

                    delete options.body;
                    options.method = 'GET';
                    options.url = location;
                    if (!silent)
                        console.log(`Job in progress. Wait for ${sleepMs} ms ...`);

                    await Promise.delay(sleepMs);
                    return options;

                }
            },
            {
                url: ROUTE_RUN_DEPLOY,
                method: 'POST',
                body: {
                    commitId,
                    from,
                    to,
                    deploy,
                    git
                }
            }
        );

        if (body.state !== 'completed') {
            console.error(`update-set state is '${body.state}' but needs to be 'completed'`, body);
            throw Error(body.state || body);
        }
        if (silent) {
            return console.dir(body, { depth: null });
        }

        const deployments = (body.deployments) ? body.deployments : [body];
        deployments.forEach((deployment) => {
            console.log(`Deployment Results:\n\tScope: ${deployment.scopeName} \n\tType: ${deployment.type} \n\tState: ${deployment.state} \n\tDuration: ${Date.parse(deployment.end) - Date.parse(deployment.start)} ms \n\tFrom: ${deployment.from} \n\tTo: ${deployment.to}`);
        });


    } catch (e) {
        console.error('Deployment Failed', e)
        throw e;
    }

}


/**
 * use 'gulp artifact' to create zip files of the current update set and the whole app
 */
const cleanArtifact = () => {
    return del('dist');
}

const artifactUs = async () => {

    const commitId = await getCommitId();
    const buildConfig = await rpd.get(`${ROUTE_BUILD_CONFIG}/${commitId}`);

    const artifact = path.resolve(buildConfig.artifact)
    console.log(`preparing artifact of ${artifact}`);
    if (artifact) {
        return src(artifact)
        .pipe(rename('artifact.xml'))
        .pipe(dest('dist', { overwrite: true }));
    }
}

const artifactApp = () => {
    console.log(`creating application artifact`);
    return src('us/**/*')
    .pipe(gulpZip('app.zip'))
    .pipe(dest('dist', { overwrite: true }));
}

const artifact = series(cleanArtifact, artifactUs, artifactApp);

exports.artifact = artifact;

exports.build = build;

exports.test = test;

exports.testApp = testApp;

exports.deploy = deploy;

exports.default = build;

exports.help = () => {
    console.log(`run: npm run <script> -- --key value --boolean`);
    console.log(`.. or alternatively: npm run gulp <gulp-command> -- --key value --boolean`);
}
