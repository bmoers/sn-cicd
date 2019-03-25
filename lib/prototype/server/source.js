
const EventBusJob = require('../../eb/job');
const EbQueueJob = require('../../eb/queue-job');
const express = require('express');

const UPDATE_SET = '/update_set';
const UPDATE_SET_XML_COUNT = '/xml_count';
const UPDATE_SET_XML_DATA = '/xml';

/**
 * Export UpdateSet - Called by 'sys_update_set_source'
 * 
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
                console.dir(err, { depth: null, colors: true });
                //console.error(err);
                res.sendStatus(400);
                return;
            }
            next();
        });
    });
    router.use(bodyParser.urlencoded({
        extended: true
    }));

    /**
     * expose update-set
     * 
     * GET to /source/head/sysId (updateSet sysId)
     */
    router.get(`${UPDATE_SET}/:commitId`, (req, res) => {

        const commitId = req.params.commitId;
        if (!commitId)
            return res.status(400).send('commitId is mandatory');

        return self.db.run.findOne({
            commitId: { $regex: new RegExp(`^${commitId}`) }
        }).then((_run) => {
            if (!_run)
                throw Error(`UpdateSet not found with commitId ${commitId}`);

            const run = _run;
            if (!run.buildPass)
                throw Error(`Build did not pass for this UpdateSet.`);

            const updateSet = run.config.updateSet;
            const requestor = run.config.build.requestor;
            const sysId = run.commitId.substr(0, 32); // 32 char version of commitId
            return res.json({
                application: updateSet.scopeId,
                dv_application: updateSet.appName,
                completed_by: requestor.userName,
                dv_completed_by: requestor.fullName,
                completed_on: updateSet.sys_updated_on,
                description: `*** Installed via CICD ***\nUpdateSet based on commit #${run.commitId.substr(0, 7)}\n${updateSet.description}`,
                name: updateSet.name,
                state: 'complete',
                sys_created_by: updateSet.sys_created_by,
                sys_created_on: updateSet.sys_created_on,
                sys_id: sysId,
                sys_updated_by: requestor.userName,
                sys_updated_on: updateSet.sys_updated_on
            });

        }).catch((e) => {
            console.error(e.message);
            return res.status(400).send(e.message);
        });

    });

    /**
     * expose update-set-xml metadata
     * 
     * GET to /source/count/sysId (updateSet sysId)
     */
    router.get(`${UPDATE_SET_XML_COUNT}/:commitId`, (req, res) => {

        const commitId = req.params.commitId;
        if (!commitId)
            return res.status(400).send('commitId is mandatory');

        return self.db.run.findOne({
            commitId: { $regex: new RegExp(`^${commitId}`) }
        }).then((_run) => {
            if (!_run)
                throw Error(`UpdateSet not found with commitId ${commitId}`);

            const run = _run;
            if (!run.buildPass)
                throw Error(`Build did not pass for this UpdateSet.`);

            return run;

        }).then((run) => {
            return new EbQueueJob({ name: 'extractUpdateSet', background: false }, { commitId: run.commitId, count: true }).then((job) => {
                return res.json(job.result);
            });

        }).catch((e) => {
            console.error(e.message);
            return res.status(400).send(e.message);
        });

    });


    /**
     * expose update-set-xml metadata
     * 
     * GET to /source/count/sysId (updateSet sysId)
     */
    router.post(`${UPDATE_SET_XML_DATA}/`, (req, res) => {
        const body = req.body;
        const commitId = body.commitId;
        const xmlSysIds = body.xmlSysIds;

        //console.log(UPDATE_SET_XML_DATA, body);

        if (!commitId)
            return res.status(400).send('sysId is mandatory');

        return self.db.run.findOne({
            commitId: { $regex: new RegExp(`^${commitId}`) }
        }).then((_run) => {
            if (!_run)
                throw Error(`UpdateSet not found with commitId ${commitId}`);

            const run = _run;
            if (!run.buildPass)
                throw Error(`Build did not pass for this UpdateSet.`);

            return run;

        }).then((run) => {
            return new EbQueueJob({ name: 'extractUpdateSet', background: false }, { commitId: run.commitId, xmlSysIds }).then((job) => {
                res.set('Content-Type', 'text/xml');
                return res.send(job.result);
            });

        }).catch((e) => {
            console.dir(e.message, { depth: null, colors: true });
            console.error(e.message);
            return res.status(400).send(e.message);
        });

    });
    return router;
};
