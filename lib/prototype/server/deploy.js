
const EventBusJob = require('../../eb/job');
const express = require('express');

const DEPLOY_EXECUTE = '/us';

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
     */
    router.post(DEPLOY_EXECUTE, (req, res) => {
        const body = req.body;
        const to = (body && body.to) ? body.to : null;
        const commitId = body.commitId;
        if (!commitId)
            return res.status(400).send('CommitID is mandatory');

        return self.db.run.find({
            commitId
        }).then((result) => {
            if (!result || !result.length)
                throw Error(`Run not found with commitId ${commitId}`);

            const run = result[0];
            if (run.deployState == 'requested')
                throw Error(`Deployment in progress`);
            
            run.deployState = 'requested'; // as 'deployUpdateSet' is background, deployState could still be on the last value (for redirect below)
            return self.db.run.update(run).then(()=> run);
        }).then((run) => {
            
            // dont wait for the deployment to complete, this can take a while
            return new EventBusJob({ name: 'deployUpdateSet', background: true }, { commitId, to }).then(() => {
                console.log('redirect to ', `/deploy/${DEPLOY_EXECUTE}/${commitId}`);
                res.setHeader('Location', `/deploy/${DEPLOY_EXECUTE}/${commitId}`);
                res.sendStatus(202); // job created, come back to url    
            });

        }).catch((e) => {
            console.error(e.message);
            return res.status(400).send(e.message);
        });
        
    });

    /**
     * access to deploy result
     */
    router.get(`${DEPLOY_EXECUTE}/:id`, (req, res) => {

        return self.db.run.find({
            commitId: req.params.id
        }).then((result) => {
            if (!result || !result.length)
                throw Error(`Run not found with commitId ${req.params.id}`);

            const run = result[0];
            if (!run.deployState)
                throw Error(`No deployment found for commitId ${req.params.id}`);
            
            console.log("run deployState", run.deployState);
            if (run.deployState != 'requested')
                return res.json(run.deploy);

            return res.redirect(304, req.originalUrl); // job running, wait and come back
        }).catch((e) => {
            console.error(e.message);
            return res.status(400).send(e.message);
        });
    });

    return router;
};