const express = require('express');
const authenticate = require('./authenticate');
const DEPLOY_EXECUTE = '/us';

const deploymentWrapper = require('../../deployment-wrapper');

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
    router.post(DEPLOY_EXECUTE, (req, res) => {
        const body = req.body;
        const from = (body && body.from) ? body.from : null;
        const to = (body && body.to) ? body.to : null;
        const git = (body && body.git != undefined) ? body.git : undefined;
        const deploy = Boolean(body && body.deploy == true);
        const commitId = body.commitId;

        if (!commitId)
            return res.status(400).send('CommitID is mandatory');

        console.log('New Deployment Request', { commitId, from, to, deploy, git });

        return deploymentWrapper.run.call(self, { commitId, from, to, deploy, git }).then((deployments) => {

            const ids = deployments.map((deployment) => (deployment.id)).join(',');

            console.log('redirect to ', `/deploy${DEPLOY_EXECUTE}/${commitId}/${ids}`);
            res.setHeader('Location', `/deploy${DEPLOY_EXECUTE}/${commitId}/${ids}`);
            res.sendStatus(202); // job created, come back to url    
        }).catch((e) => {
            console.error(e.message);
            return res.status(400).send(e.message);
        });

    });

    /**
     * access to deploy result
     */
    router.get(`${DEPLOY_EXECUTE}/:commitId/:ids`, (req, res) => {
        return deploymentWrapper.get.call(self, { commitId: req.params.commitId, ids: req.params.ids }).then((results) => {
            return res.json(results);
        }).catch((e) => {
            if (e && e.message == '304')
                return res.redirect(304, req.originalUrl); // job requested, wait and come back
            console.error(e.message || e);
            return res.status(400).send(e.message || e);
        });
    });

    return router;
};
