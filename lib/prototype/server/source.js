const EventBusJob = require('../../eb/job');
const EbQueueJob = require('../../eb/queue-job');
const express = require('express');

const UPDATE_SET = '/update_set';
const UPDATE_SET_XML_COUNT = '/xml_count';
const UPDATE_SET_XML_DATA = '/xml';
const SYS_SCOPE = '/sys_scope';
/**
 * Export UpdateSet - Called by 'sys_update_set_source'
 * 
 */
module.exports = function () {
    const self = this;

    const router = express.Router();

    /**
     * expose update-set
     * 
     * GET to /source/update_set/sysId (updateSet sysId)
     */
    router.get(`${UPDATE_SET}/:deploymentId`, (req, res) => {

        const deploymentId = req.params.deploymentId;
        if (!deploymentId)
            return res.status(400).send('deploymentId is mandatory');
        /*
        return self.db.run.findOne({
            commitId: { $regex: new RegExp(`^${commitId}`) }
        })
        */
        return self.db.deployment.findOne({
            _id: deploymentId
        }).then(async (deployment) => {
            if (!deployment)
                throw Error(`Deployment not found with id ${deploymentId}`);

            const run = await self.db.run.findOne({
                _id: deployment.runId
            });

            return { run, deployment };

        }).then(({ run, deployment }) => {
            if (!run)
                throw Error(`UpdateSet not found with id ${deployment.runId}`);

            if (!run.buildPass)
                throw Error('Build did not pass for this UpdateSet.');

            const requestor = run.config.build.requestor;
            const sysId = deployment.sysId;

            const runUpdateSet = run.config.updateSet; // the update set on which the build run was triggered
            const updateSet = deployment.scope.updateSet || runUpdateSet;
            const scopeName = deployment.scopeName || runUpdateSet.scopeName;

            /*
            <application display_value="CICD Test Application">268e9d5fdbb32300fcf417803996195e</application>
            <application_name>CICD Test Application</application_name>
            <application_scope>x_11413_cicd_test</application_scope>
            <application_version>1.0.0</application_version>
            */

            return res.json({
                application: updateSet.scopeId,
                dv_application: updateSet.appName,

                application_name: updateSet.appName,

                application_scope: scopeName,
                application_version: updateSet.appVersion || 0,

                completed_by: requestor.userName,
                dv_completed_by: requestor.fullName,
                completed_on: runUpdateSet.sys_updated_on,
                
                name: deployment.name,
                description: deployment.description,
                
                state: 'complete',
                sys_created_by: runUpdateSet.sys_created_by,
                sys_created_on: runUpdateSet.sys_created_on,
                sys_id: sysId,
                sys_updated_by: requestor.userName,
                sys_updated_on: runUpdateSet.sys_updated_on
            });

        }).catch((e) => {
            console.error(e.message);
            return res.status(400).send(e.message);
        });

    });

    /**
     * expose update-set-xml metadata
     * 
     * GET to /source/xml_count/sysId (updateSet sysId)
     */
    router.get(`${UPDATE_SET_XML_COUNT}/:deploymentId`, (req, res) => {

        //console.log(`${UPDATE_SET_XML_COUNT}/:deploymentId`, req.params.deploymentId);

        const deploymentId = req.params.deploymentId;
        if (!deploymentId)
            return res.status(400).send('deploymentId is mandatory');

        // commitId : { $regex: new RegExp(`^${commitId}`) }
        return self.db.deployment.findOne({
            _id: deploymentId
        }).then((_deployment) => {
            if (!_deployment)
                throw Error(`UpdateSet not found with deploymentId ${deploymentId}`);

            return self.db.run.findOne({
                _id: _deployment.runId
            }).then((run) => {
                if (!run.buildPass)
                    throw Error('Build did not pass for this UpdateSet.');

                return _deployment;
            });

        }).then((deployment) => {

            return new EventBusJob({ name: 'extractUpdateSet', background: false, host: deployment.host }, { deploymentId: deployment._id, count: true }).then((job) => {
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
     * POST to /source/xml (updateSet sysId)
     */
    router.post(`${UPDATE_SET_XML_DATA}/`, (req, res) => {
        const body = req.body;
        const commitId = body.commitId;
        const xmlSysIds = body.xmlSysIds;

        //console.log(UPDATE_SET_XML_DATA, body);

        if (!commitId)
            return res.status(400).send('sysId is mandatory');

        // commitId : { $regex: new RegExp(`^${commitId}`) }
        return self.db.deployment.findOne({
            _id: commitId
        }).then((_deployment) => {
            if (!_deployment)
                throw Error(`UpdateSet not found with commitId ${commitId}`);

            return self.db.run.findOne({
                _id: _deployment.runId
            }).then((run) => {
                if (!run.buildPass)
                    throw Error('Build did not pass for this UpdateSet.');

                return _deployment;
            });

        }).then((deployment) => {

            return new EventBusJob({ name: 'extractUpdateSet', background: false, host: deployment.host }, { deploymentId: deployment._id, xmlSysIds }).then((job) => {
                res.set('Content-Type', 'text/xml');
                return res.send(job.result);
            });

        }).catch((e) => {
            console.dir(e.message, { depth: null, colors: true });
            console.error(e.message);
            console.error(e);
            return res.status(400).send(e.message);
        });

    });

    /**
     * expose scope
     * 
     * GET to /source/sys_scope/scopeId
     */
    router.get(`${SYS_SCOPE}/:scopeId`, (req, res) => {

        //console.log(`${SYS_SCOPE}/:scopeId`, req.params.scopeId);

        const scopeId = req.params.scopeId;
        if (!scopeId)
            return res.status(400).send('scopeId is mandatory');
        /*
        return self.db.run.findOne({
            commitId: { $regex: new RegExp(`^${commitId}`) }
        })
        */
        return self.db.us.findOne({
            'updateSet.scopeId': scopeId
        }).then((us) => {
            if (!us)
                throw Error(`Deployment not found with id ${scopeId}`);

            const updateSet = us.updateSet;
            return res.json({
                sys_id: updateSet.scopeId,
                name: updateSet.appName,
                scope: updateSet.scopeName,
                source: updateSet.scopeName,
                version: updateSet.appVersion
            });

        }).catch((e) => {
            console.error(e.message);
            return res.status(400).send(e.message);
        });

    });

    return router;
};
