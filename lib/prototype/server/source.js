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
        }).then((deployment) => {
            if (!deployment)
                throw Error(`Deployment not found with id ${deploymentId}`);

            return self.db.run.findOne({
                _id: deployment.runId
            }).then((run) => ({ run, deployment }));

        }).then(({ run, deployment }) => {
            if (!run)
                throw Error(`UpdateSet not found with id ${deployment.runId}`);

            if (!run.buildPass)
                throw Error(`Build did not pass for this UpdateSet.`);

            const updateSet = run.config.updateSet;
            const requestor = run.config.build.requestor;
            const scopeName = deployment.scopeName || updateSet.scopeName;


            /* as we can have multiple deployments 
                as the application entity container allows to be multi-scoped, we must run multiple deployments for the same commit id.
                so for every scope, there must be a unique id based on the scope + commit id
            */
            const sysId = require('crypto').createHash('md5').update(scopeName.concat(run.commitId)).digest('hex');
            const mergedDeployment = Boolean(run.config.application.mergedDeployment);
            /*
            <application display_value="CICD Test Application">268e9d5fdbb32300fcf417803996195e</application>
            <application_name>CICD Test Application</application_name>
            <application_scope>x_11413_cicd_test</application_scope>
            <application_version>1.0.0</application_version>
            */

            /*
                TODO:
                    rework the update set name generation
                    unique name for the update set would help to identify the version of the application 
                    e.g. just prepend the commit id?
            */
            let name = updateSet.name;
            if (mergedDeployment) {
                name = `${updateSet.appName} - ${updateSet.appVersion || ''}`;
                if (updateSet.name != name) {
                    name = `${updateSet.name} (${name})`;
                }
            }

            return res.json({
                application: updateSet.scopeId,
                dv_application: updateSet.appName,

                application_name: updateSet.appName,

                application_scope: updateSet.scopeName,
                application_version: updateSet.appVersion || 0,

                completed_by: requestor.userName,
                dv_completed_by: requestor.fullName,
                completed_on: updateSet.sys_updated_on,
                description: `Installed via CICD ${mergedDeployment ? '\n >  Merged Update Set Deployment ' : ''}\n >  Update set based on Commit ID #${run.commitId.substr(0, 7)} \n--\n${updateSet.description}`,
                name: name,
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
     * GET to /source/xml_count/sysId (updateSet sysId)
     */
    router.get(`${UPDATE_SET_XML_COUNT}/:deploymentId`, (req, res) => {

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
                    throw Error(`Build did not pass for this UpdateSet.`);

                return _deployment;
            });

        }).then((deployment) => {

            return new EventBusJob({ name: 'extractUpdateSet', background: false }, { deploymentId: deployment._id, count: true }).then((job) => {
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
     * GET to /source/xml/sysId (updateSet sysId)
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
                    throw Error(`Build did not pass for this UpdateSet.`);

                return _deployment;
            });

        }).then((deployment) => {

            return new EventBusJob({ name: 'extractUpdateSet', background: false }, { deploymentId: deployment._id, xmlSysIds }).then((job) => {
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
    return router;
};
