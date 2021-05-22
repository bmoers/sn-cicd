const express = require('express');
const Bluebird = require('bluebird');
const fileUpload = Bluebird.promisifyAll(require('express-fileupload'));
const mkdirp = require('mkdirp');
const fs = require('fs-extra');
const path = require('path');
const extract = require('extract-zip');
const { v4: uuidv4 } = require('uuid');
const authenticate = require('./authenticate');
const multer = require('multer');
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, require('os').tmpdir()),
    filename: (req, file, cb) => cb(null, `${file.fieldname}-${uuidv4()}.zip`)
});

const testWrapper = require('../../test-wrapper');
const EventBusJob = require('../../eb/job');
const EbQueueJob = require('../../eb/queue-job');

const ROUTE_GULP_COMPLETE = '/complete';
const ROUTE_TASK_COMPLETE = '/task';
const ROUTE_BUILD_CONFIG = '/config';

const ROUTE_TEST_CONFIG = '/test';
const ROUTE_TEST_EXECUTE = '/test';
const ROUTE_APP_TEST_EXECUTE = '/test/app';
/**
 * Gulp Build related API
 * Mainly to start ATF testrunner Job and return ServiceNow test results.
 * Allso exposes API to upload HTML files from Gulp steps (e.g. Lint, JsDoc) in ZIP format
 */
module.exports = function () {
    const self = this;

    const router = express.Router();
    router.use(authenticate(process.env.CICD_BUILD_ACCESS_TOKEN));

    /**
     * get build configuration for a commit ID
     * GET: /build/config/<commitId>
     */
    router.get(`${ROUTE_BUILD_CONFIG}/:commitId`, (req, res) => {
        return self.db.run.findOne({
            commitId: req.params.commitId
        }).then((run) => {
            if (!run)
                throw Error(`Config not found for commitId ${req.params.commitId}`);

            // only run the build if there is no pending pull request for this branch
            return self.pendingPullRequest({
                config: run.config,
                repoName: run.config.git.repository,
                from: run.config.branchName
            }).then((pending) => {
                if (!pending)
                    return;
                // update status
                return self.db.us.update({ _id: run.usId, pullRequestRaised: true }, true).then(() => {
                    throw Error('there is already a pending pull request for this update-set');
                });
            }).then(() => {

                if (run.build.test.enabled == true) {
                    /* if the test configuration is enabled (in build-config.json)
                        disable in case ATF is disabled on the server (via process.env.CICD_ATF_ENABLED)
                    */
                    if (run.config.atf.enabled == false) {
                        console.log('Build Config: disable ATF test execution. (run.config.atf.enabled == false)');
                        run.build.test.enabled = false;
                    }
                }

                return res.json(run.build);
            });
        }).catch((e) => {
            console.error(`failure in ${ROUTE_BUILD_CONFIG} : ${e.message} ${e}`);
            return res.status(400).send(e.message);
        });
    });

    /**
     * Run ATF tests in ServiceNow 
     * POST: /build/test
     * 
     * @param {Object} req
     * @param {Object} req.body.commitId the commit id to test
     * @param {Object} req.body.on the environment on which to run the tests
     * @returns {Promise<void>} 
     */
    router.post(ROUTE_TEST_EXECUTE, (req, res) => {
        const body = req.body;
        const on = (body && body.on) ? body.on : null;
        const commitId = body.commitId;

        if (!commitId)
            return res.status(400).send('CommitID is mandatory');

        return testWrapper.run.call(self, { commitId, on }).then(({ id }) => {
            console.log('redirect to ', `/build${ROUTE_TEST_CONFIG}/${id}`);
            res.setHeader('Location', `/build${ROUTE_TEST_CONFIG}/${id}`);
            res.sendStatus(202); // job created, come back to url
        }).catch((e) => {
            console.error(`failure in ${ROUTE_TEST_EXECUTE} : ${e.message} ${e}`);
            return res.status(400).send(e.message);
        });

    });

    /**
     * Run ATF tests in ServiceNow 
     * POST: /build/test/app
     * 
     * @param {Object} req
     * @param {Object} req.body.suites the suites to be executed
     * @param {Object} req.body.tests the tests to be executed
     * @param {Object} req.body.on the environment on which to run the tests
     * @returns {Promise<void>} 
     */
    router.post(ROUTE_APP_TEST_EXECUTE, (req, res) => {
        const body = req.body;
        const on = (body && body.on) ? body.on : null;
        
        const suites = (body.suites || '').split(',');
        const tests = (body.tests || '').split(',');

        if (!on)
            return res.status(400).send('Target host name is mandatory');
        
        if (suites.length == 0 && tests.length == 0)
            return res.status(400).send('no \'suites\', no \'tests\' specified.');

        return testWrapper.runApp.call(self, { on, suites, tests }).then(({ id }) => {
            console.log('redirect to ', `/build${ROUTE_TEST_CONFIG}/${id}`);
            res.setHeader('Location', `/build${ROUTE_TEST_CONFIG}/${id}`);
            res.sendStatus(202); // job created, come back to url
        }).catch((e) => {
            console.error(`failure in ${ROUTE_TEST_EXECUTE} : ${e.message} ${e}`);
            return res.status(400).send(e.message);
        });

    });

    /**
     * load latest ATF test results
     * GET: /build/test/<id>
     */
    router.get(`${ROUTE_TEST_CONFIG}/:id`, (req, res) => {
        return testWrapper.get.call(self, { id: req.params.id }).then((results) => {
            return res.json(results);
        }).catch((e) => {
            if (e && e.message == '304')
                return res.redirect(304, req.originalUrl); // job requested, wait and come back

            console.error(`failure in ${ROUTE_TEST_CONFIG} : ${e.message} ${e}`);
            return res.status(400).send(e.message);
        });
    });

    /**
     * Build has completed, called from GULP process
     * final call once gulp is complete
     * as the zip upload (/task) are done background, this can be called
     * before all files are uploaded
     *
     * This might trigger internally the deployment of the update-set
     * 
     * POST: /build/complete
     * 
     * @param {Object} req
     * @param {Object} req.body the build results
     * @param {Object} req.body.commitId the commit id to complete
     * @returns {Promise<void>}
     */
    router.post(ROUTE_GULP_COMPLETE, (req, res) => {

        const buildResult = req.body;
        const commitId = req.body.commitId;
        if (!commitId)
            return res.status(400).send('data and commitID are mandatory');

        return self.db.run.findOne({ commitId }).then((_run) => {
            if (!_run)
                throw Error(`Run not found with commitId ${commitId}`);
            return _run;
            //return self.db.run.update(run).then(()=> run);
        }).then((run) => {
            return new EbQueueJob({ name: 'buildComplete', background: true }, {
                runId: run._id,
                buildResult: buildResult
            });
        }).then((job) => {
            res.send(`Thanks for submitting. JobId is ${job._id}`);
        }).catch((e) => {
            console.error(`failure in ${ROUTE_GULP_COMPLETE} : ${e.message} ${e}`);
            return res.status(400).send(e.message);
        });
    });

    /**
     * gulp tasks are sent as zip
     * POST: /build/task
     */
    router.post(ROUTE_TASK_COMPLETE, multer({ storage }).single('zip'), (req, res) => {
        let run;

        if (!req.body.data)
            return res.status(400).send('data is mandatory');

        const data = JSON.parse(req.body.data);

        const task = data.task;
        if (task === undefined)
            return res.status(400).send('task is mandatory');

        const taskPass = data.testPass;
        if (taskPass === undefined)
            return res.status(400).send('testPass is mandatory');

        const commitId = data.commitId;
        if (!commitId)
            return res.status(400).send('commitID is mandatory');



        return self.db.run.findOne({ commitId }).then((_run) => {
            if (!_run)
                throw Error(`Run not found with commitId ${commitId}`);

            run = _run;

        }).then(() => {
            const buildTask = run.build[task];
            if (!buildTask) {
                throw new Error(`Unknown build task ${task}`);
            }

            run.buildResults[task] = taskPass;
            if (buildTask.breakOnError && !taskPass)
                run.buildPass = false;

            return self.db.run.update(run);

        }).then(async () => {
            if (!req.file) {
                return res.send('No files were uploaded.');
            }

            const uploadPath = req.file.path;
            const zipTarget = path.join(run.dir.doc, task);

            console.log(`delete all files in '${zipTarget}'`);
            await fs.remove(zipTarget);

            console.log(`un-zip files from '${uploadPath}' into '${zipTarget}'`);
            await extract(uploadPath, {
                dir: zipTarget
            });

            console.log(`delete temp file '${uploadPath}'`);
            await fs.remove(uploadPath);

            return res.send('File uploaded!');

        }).catch((e) => {
            console.error(`failure in ${ROUTE_TASK_COMPLETE} : ${e.message} ${e}`);
            return res.status(400).send(e.message);
        });
    });

    return router;
};
