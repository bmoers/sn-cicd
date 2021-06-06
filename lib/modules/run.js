const path = require('path');
const ExeJob = require('../eb/job');
const HouseKeepingJob = require('../eb/housekeeping');

/**  
 * Run the whole CICD pipeline.
 * If required the request body can be modified in self.convertBuildBody()
 * 
 * Mapped to /run
 * 
 * @param {Object} options the information about the update-set to be send to the pipeline
 * @param {Console} logger a logger to be used
 * @param {Object} job job object
 * @returns {Promise<void>}
 */
// eslint-disable-next-line no-unused-vars
module.exports = async function (options, logger = console, { host }) {
    const self = this;
    let config = {};
    let error;

    const step = (message, error) => {
        return self.addStep(console, config, `${path.basename(__filename).split('.')[0]}.run : ${message}`, error);
    };

    try {

        let buildOnHost;
        let runId;

        let run = await self.db.run.get(options.runId);
        if (run) {
            // if conflicts are resolved re-run job 
            ({ config, _id: runId, buildOnHost } = run);

            // update run state
            await self.db.us.update({ _id: run.usId, running: true });

        } else {
            // run new job
            const jobResult = await new ExeJob({ name: 'projectSetup' }, options, logger);
            ({ config, runId } = jobResult.result);

            // all succeeding jobs must run on the same host
            buildOnHost = jobResult.host;

            // update the buildOnHost information
            await self.db.run.update({ _id: runId, buildOnHost });

        }
        
        // in case of update-set collisions (conflict) stop here
        ({ result: run } = await new ExeJob({ name: 'runCollisionDetection', host: buildOnHost, exclusiveId: `pref-${config.application._id}` }, runId, logger));
        if (run.config.build.collisionDetection && run.collision.state != 'passed'){
            await step(`Update set is causing conflicts on target environment. Review issues here: ${run.collision.remoteUpdateSetUrl}`);
            return;
        }

        // no conflicts or resolved, proceed
        await new ExeJob({ name: 'exportFilesFromMaster', host: buildOnHost }, runId, logger);
        await new ExeJob({ name: 'exportUpdateSet', host: buildOnHost }, runId, logger);

        if (process.env.CICD_EMBEDDED_BUILD === 'true') {
            await new ExeJob({ name: 'buildProject', host: buildOnHost }, runId, logger);
        } else {
            await step('Embedded Build is disabled. Waiting for external Build Tool to run.');
        }

        // clean up directory
        await new HouseKeepingJob({ codeDir: run.dir.code }, buildOnHost, logger);


    } catch (e) {
        error = e;

        await self.setProgress(config, this.build.FAILED);
        await step('failed', e);

        logger.error(e);

    } finally {
        self.finalizeRun(config, error);
    }
};
