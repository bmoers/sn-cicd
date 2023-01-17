const express = require('express');
const authenticate = require('./authenticate');
const DEPLOY_EXECUTE = '/us';
const ExeJob = require('../../eb/job');
const QueueJob = require('../../eb/queue-job');




/**
 * Allow to trigger a US deployment via REST api.
 * POST to /deploy/us with commitId and optional target host will start deployment.
 */
module.exports = function () {
    const self = this;

    const router = express.Router();
    router.use(authenticate(process.env.CICD_DEPLOY_ACCESS_TOKEN));

    /**
     * start deployment of update-set
     * @param {Object} req
     * @param {Object} req.body.commitId the commit id to deploy
     * @param {Object} req.body.from deploy the us from this environment
     * @param {Object} req.body.to deploy the us to this environment
     * @returns {Promise<void>}
     */
    router.post(DEPLOY_EXECUTE, async (req, res) => {
        const body = req.body;
        const from = (body && body.from) ? body.from : null;
        const to = (body && body.to) ? body.to : null;
        const git = (body && body.git != undefined) ? body.git : undefined;
        const deploy = Boolean(body && body.deploy == true);
        const commitId = body.commitId;

        try {
            if (!commitId)
                throw Error('CommitID is mandatory');

            //console.log('New Deployment Request', { commitId, from, to, deploy, git });

            const job = await new ExeJob({ name: 'deploy', background: true, exclusiveId: `deploy-${commitId}`, description: `Deploy ${commitId}` },
                { commitId, from, to, deploy, git });
            console.log(`Deployment job started. JobId: ${job._id}`);

            console.log('redirect to ', `${req.baseUrl}${DEPLOY_EXECUTE}/job/${job._id}`);
            res.setHeader('Location', `${req.baseUrl}${DEPLOY_EXECUTE}/job/${job._id}`);
            res.sendStatus(202); // job created, come back to url 

            /*
            const deploymentWrapper = require('../../deployment-wrapper');
            return deploymentWrapper.run.call(self, { commitId, from, to, deploy, git }).then((deployments) => {
    
                const ids = deployments.map((deployment) => (deployment.id)).join(',');
    
                console.log('redirect to ', `/deploy${DEPLOY_EXECUTE}/${commitId}/${ids}`);
                res.setHeader('Location', `/deploy${DEPLOY_EXECUTE}/${commitId}/${ids}`);
                res.sendStatus(202); // job created, come back to url    
            }).catch((e) => {
                console.error(e.message);
                return res.status(400).send(e.message);
            });
            */

        } catch (e) {
            console.error(__filename, 'error:', req.originalUrl, e);
            return res.status(400).send(e.message || e);
        }
    });

    /**
     * access to deploy job
     */
    router.get(`${DEPLOY_EXECUTE}/job/:id`, async (req, res) => {

        try {

            const job = await self.db.job_queue.findOne({ _id: req.params.id });

            //console.log('deployment job: ', job);

            if (!job)
                throw Error(`job not found with id: ${req.params.id}`);

            if (!job.completed)
                return res.redirect(304, req.originalUrl); // job in progress, wait and come back

            // job has completed
            console.log('deployment (wrapper) job completed');

            if (job.error)
                throw job.error;

            if (!job.result || !Array.isArray(job.result))
                throw Error(`no result in job ${job._id}`);

            if (!Array.isArray(job.result))
                throw Error('invalid job result: ', job.result);

            if (!job.result.length)
                throw Error('no result in job: ', job.result);


            const commitId = job.result[0].commitId;
            const deploymentIds = job.result.map((deployment) => (deployment.id)).join(',');

            console.log('commitId:', commitId);
            console.log('deploymentIds: ', deploymentIds);

            console.log('redirect to ', `${req.baseUrl}${DEPLOY_EXECUTE}/result/${commitId}/${deploymentIds}`);
            res.setHeader('Location', `${req.baseUrl}${DEPLOY_EXECUTE}/result/${commitId}/${deploymentIds}`);
            res.sendStatus(202); // redirect to pull for deployment results

        } catch (e) {
            console.error(__filename, 'error:', req.originalUrl, e);
            //console.trace();
            return res.status(400).send(e.message || e);
        }
    });


    /**
     * access to deployment result
     */
    router.get(`${DEPLOY_EXECUTE}/result/:commitId/:ids`, async (req, res) => {
        try {

            const commitId = req.params.commitId;
            const deploymentIds = req.params.ids.split(',');

            const run = await self.db.run.findOne({
                commitId
            });
            if (!run)
                throw Error(`Run not found with commitId ${commitId}`);

            const deployments = await self.db.deployment.find({
                commitId,
                _id: { $in: deploymentIds }
            });
            if (!deployments || deployments.length == 0)
                throw Error(`No deployment found with ID's ${deploymentIds}`);

            // all deployments processed (completed or failed)
            if (deployments.every((deployment) => (deployment.state != 'requested'))) {
                if (deployments.every((deployment) => (deployment.state == 'completed'))) {
                    return res.json({ state: 'completed', deployments });
                } else {
                    const failed = deployments.filter((deployment) => (deployment.state != 'completed'));
                    const detail = failed.map((f)=> `${f.name} - ${f.state}`);
                    console.error(`Deployment Failed : ${failed.length} out of ${deployments.length} need attention: ${detail}`, failed);
                    throw deployments;
                }
            }
            return res.redirect(304, req.originalUrl); // job in progress, wait and come back

        } catch (e) {
            console.error(__filename, 'error:', req.originalUrl, e);
            return res.status(400).send(e.message || e);
        }
    });


    return router;
};
