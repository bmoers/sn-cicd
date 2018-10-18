const express = require('express');
const Bluebird = require('bluebird');
const fileUpload = Bluebird.promisifyAll(require('express-fileupload'));
const mkdirp = Bluebird.promisifyAll(require('mkdirp'));
const fs = require('fs-extra');
const path = require("path");
const extract = Bluebird.promisify(require('extract-zip'));
const uui = require('uuid/v4');

const EventBusJob = require('../../eb/job');

const ROUTE_GULP_COMPLETE = '/complete';
const ROUTE_TASK_COMPLETE = '/task';
const ROUTE_BUILD_CONFIG = '/config';

const ROUTE_TEST_CONFIG = '/test';
const ROUTE_TEST_EXECUTE = '/test';
/**
 * Gulp Build related API
 * Mainly to start ATF testrunner Job and return ServiceNow test results.
 * Allso exposes API to upload HTML files from Gulp steps (e.g. Lint, JsDoc) in ZIP format
 */
module.exports = function () {
    const self = this;

    const router = express.Router();
    const bodyParser = require('body-parser');



    router.use((req, res, next) => {
        bodyParser.json({
            verify: (req2, res, buf) => {
                req2.rawBody = buf.toString();
            }
        })(req, res, (err) => {
            if (err) {
                console.error(err);
                res.sendStatus(400);
                return;
            }
            next();
        });
    });
    router.use(bodyParser.urlencoded({
        extended: true
    }));
    router.use(fileUpload());

    function isAuthenticated(req, res, next) {
        var token = req.headers['x-access-token'];
        if (!token)
            return res.status(401).send({
                message: 'Unauthorized'
            });
        if (process.env.CICD_BUILD_ACCESS_TOKEN !== token)
            return res.status(500).send({
                message: 'Failed to authenticate.'
            });

        return next();
    }

    router.use(isAuthenticated);

    /**
     * load latest ATF test results
     */
    router.get(`${ROUTE_TEST_CONFIG}/:id`, (req, res) => {
        
        return self.db.run.get({
            _id: req.params.id
        }).then((run) => {
            if (run.testJob == 'complete')
                return res.json(run.testResults);

            return res.redirect(304, req.originalUrl); // job running, wait and come back
        });
    });

    /**
     * Run ATF tests in ServiceNow
     * 
     * @param {Object} req
     * @param {Object} req.body.commitId the commit id to complete
     * @returns {Promise<void>}  the related update set
     */
    router.post(ROUTE_TEST_EXECUTE, (req, res) => {
        const commitId = req.body.commitId;
        if (!commitId)
            return res.status(400).send('data and commitID are mandatory');

        return self.db.run.findOne({ commitId }).then((_run) => {
            if (!_run)
                throw Error(`Run not found with commitId ${commitId}`);

            const run = _run;
            run.testJob = 'requested';
            return self.db.run.update(run).then(() => run);
        }).then((run) => {
            /*
                shall this be chnaged to a EbQueueJob ?
                in that case the job might take a while to start.... will the gulp client pull for so long?
            */
            return new EventBusJob({ name: 'testProject', background: true }, run._id).then(() => {
                console.log('redirect to ', `/build/${ROUTE_TEST_CONFIG}/${run._id}`);
                res.setHeader('Location', `/build/${ROUTE_TEST_CONFIG}/${run._id}`);
                res.sendStatus(202); // job created, come back to url
            });

        }).catch((e) => {
            console.error(e.message);
            return res.status(400).send(e.message);
        });
        /*
        return self.testProject({
                build: build,
                commitId: commitId
        }).then((run) => {
            console.log('redirect to ', `/build/${ROUTE_TEST_CONFIG}/${run._id}`);
            res.setHeader('Location', `/build/${ROUTE_TEST_CONFIG}/${run._id}`);
            res.sendStatus(202); // job created, come back to url
        }).catch((e) => {
            console.error(e.message);
            return res.status(400).send(e.message);
        });
        */
    });

    /**
     * Build has completed, called from GULP process
     * final call once gulp is complete
     * as the zip upload (/task) are done background, this can be called
     * before all files are uploaded
     *
     * This might trigger internally the deployment of the update-set
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
            return new EventBusJob({ name: 'buildComplete', background: true }, {
                runId: run._id,
                buildResult: buildResult
            });
        }).then(() => {
            res.send('Thanks for submitting');
        }).catch((e) => {
            console.error(e.message);
            return res.status(400).send(e.message);
        });
    });

    /**
     * gulp tasks are sent as zip
     */
    router.post(ROUTE_TASK_COMPLETE, (req, res) => {
        let run;

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

        

        return self.db.run.findOne({ commitId }).then((_run) => {
            if (!_run)
                throw Error(`Run not found with commitId ${commitId}`);
            
            run = _run;
      
        }).then(() => {
            const buildTask = run.build[task];
            if (!buildTask) {
                throw new Error(`Unknown build task ${task}`);
            }

            run.buildResults[task] = testPass;
            if (buildTask.breakOnError && !testPass)
                run.buildPass = false;

            return self.db.run.update(run);

        }).then(() => {
            if (!req.files || !req.files.zip) {
                return res.send('No files were uploaded.');
            }
            return mkdirp.mkdirpAsync(run.dir.tmp).then(() => {
                const tempZip = path.join(run.dir.tmp, `${uui()}.zip`);
                console.log(`upload zip file to ${tempZip}`);
                return req.files.zip.mv(tempZip).then(() => tempZip);
            }).then((tempZip) => {
                const zipTarget = path.join(run.dir.doc, task);
                console.log(`delete all files in '${zipTarget}'`);
                return fs.removeAsync(zipTarget).then(() => {
                    console.log(`un-zip files into '${zipTarget}'`);
                    return extract(tempZip, {
                        dir: zipTarget
                    });
                }).then(() => {
                    console.log(`delete temp file '${tempZip}'`);
                    return fs.removeAsync(tempZip);
                });

            }).then(() => {
                return res.send('File uploaded!');
            });

        }).catch((e) => {
            return res.status(400).send(e.message);
        });
    });

    /**
     * get build configuration for a commit ID
     */
    router.get(`${ROUTE_BUILD_CONFIG}/:commitId`, (req, res) => {
        return self.db.run.findOne({
            commitId: req.params.commitId
        }).then((_run) => {
            if (!_run)
                throw Error(`Config not found for commitId ${req.params.commitId}`);
            
            return res.json(_run.build);
        }).catch((e) => {
            console.error(e.message);
            return res.status(400).send(e.message);
        });
    });

    return router;
};