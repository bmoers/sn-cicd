const express = require('express');
const DEPLOY_EXECUTE = '/us';

const deploymentWrapper = require('../../deployment-wrapper');

/**
 * Allow to trigger a US deployment via REST api.
 * POST to /deploy/us with commitId and optional target host will start deployment.
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

    function isAuthenticated(req, res, next) {
        var token = req.headers['x-access-token'];
        if (!token)
            return res.status(401).send({
                message: 'Unauthorized'
            });
        if (process.env.CICD_DEPLOY_ACCESS_TOKEN !== token)
            return res.status(500).send({
                message: 'Failed to authenticate.'
            });

        return next();
    }

    router.use(isAuthenticated);

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

        console.log("New Deployment Request", { commitId, from, to, deploy, git });

        return deploymentWrapper.run.call(self, { commitId, from, to, deploy, git }).then(() => {
            console.log('redirect to ', `/deploy${DEPLOY_EXECUTE}/${commitId}/`);
            res.setHeader('Location', `/deploy${DEPLOY_EXECUTE}/${commitId}/`);
            res.sendStatus(202); // job created, come back to url    
        }).catch((e) => {
            console.error(e.message);
            return res.status(400).send(e.message);
        });

    });

    /**
     * access to deploy result
     */
    router.get(`${DEPLOY_EXECUTE}/:commitId/`, (req, res) => {
        return deploymentWrapper.get.call(self, { commitId: req.params.commitId }).then((results) => {
            return res.json(results);
        }).catch((e) => {
            if (e && e.message == '304')
                return res.redirect(304, req.originalUrl); // job requested, wait and come back
            console.error(e.message);
            return res.status(400).send(e.message);
        });
    });

    return router;
};
