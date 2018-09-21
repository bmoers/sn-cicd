const express = require('express');
const Bluebird = require('bluebird');
const fileUpload = Bluebird.promisifyAll(require('express-fileupload'));
const assign = require('object-assign-deep');
const mkdirp = Bluebird.promisifyAll(require('mkdirp'));
const fs = require('fs-extra');
const path = require("path");
const extract = Bluebird.promisify(require('extract-zip'));
const uui = require('uuid/v4');

const EventBusJob = require('../../eb/job');

const ROUTE_BUILD_COMPLETE = '/complete';
const ROUTE_TASK_COMPLETE = '/task';
const ROUTE_BUILD_CONFIG = '/config';

const ROUTE_TEST_CONFIG = '/test';
const ROUTE_TEST_EXECUTE = '/test';

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
        // do any checks you want to in here
        var token = req.headers['x-access-token'];
        if (!token)
            return res.status(401).send({
                auth: false,
                message: 'No token provided.'
            });
        if (process.env.CICD_BUILD_ACCESS_TOKEN !== token)
            return res.status(500).send({
                auth: false,
                message: 'Failed to authenticate token.'
            });

        return next();
    }

    router.use(isAuthenticated);

    /**
     * load latest ATF test results
     */
    router.get(`${ROUTE_TEST_CONFIG}/:id`, (req, res) => {
        
        return self.db.us.get({
            _id: req.params.id
        }).then((us) => {
            if (us.testJob == 'complete')
                return res.json(us.testResults);

            return res.redirect(304, req.originalUrl); // job running, wait and come back
        });
    });

    /**
     * start ATF test run in ServiceNow
     */
    router.post(ROUTE_TEST_EXECUTE, (req, res) => {

        const build = req.body;
        const commitId = build.commitId;
        if (!build || !commitId)
            return res.status(400).send('data and commitID are mandatory');

        return self.testProject({
                build: build,
                commitId: commitId
        }).then((us) => {
            console.log('redirect to ', `/build/${ROUTE_TEST_CONFIG}/${us._id}`);
            res.setHeader('Location', `/build/${ROUTE_TEST_CONFIG}/${us._id}`);
            res.sendStatus(202); // job created, come back to url
        }).catch((e) => {
            console.error(e);
            return res.status(400).send(e.message);
        });

    });

    /**
     * final call once gulp is complete
     * as the zip upload (/task) are done async, this can be called 
     * before all files are uploaded
     */
    router.post(ROUTE_BUILD_COMPLETE, (req, res) => {

        const build = req.body;
        const commitId = build.commitId;
        if (!build || !commitId)
            return res.status(400).send('data and commitID are mandatory');
        
        return self.buildComplete({ build : build, commitId: commitId }).then(() => {
            res.send('Thanks for submitting');
        });
    });

    /**
     * gulp tasks are sent as zip
     */
    router.post(ROUTE_TASK_COMPLETE, (req, res) => {

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
                us.buildPass = false;

            return self.db.us.update(us).then(() => us);

        }).then((us) => {
            if (!req.files || !req.files.zip) {
                return res.send('No files were uploaded.');
            }
            return mkdirp.mkdirpAsync(us.config.application.dir.tmp).then(() => {
                const tempZip = path.join(us.config.application.dir.tmp, `${uui()}.zip`);
                console.log(`upload zip file to ${tempZip}`);
                return req.files.zip.mv(tempZip).then(() => tempZip);
            }).then((tempZip) => {
                //console.log(tempZip);
                const zipTarget = path.join(us.config.application.dir.doc, task);
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
    router.get(`${ROUTE_BUILD_CONFIG}/:commitID`, (req, res) => {
        return self.db.us.find({
            commitId: req.params.commitID
        }).then((result) => {
            if (result && result.length)
                return res.json(result[0].build);
            res.json({});
        });
    });

    return router;
};