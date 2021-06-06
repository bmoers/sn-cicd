const Promise = require('bluebird');
const path = require('path');
const ExeJob = require('../eb/job');
const HouseKeepingJob = require('../eb/housekeeping');

/** 
 * Only export the update-set from Service-Now.
 * If required the request body can be modified in self.convertBuildBody().
 * 
 * mapped to /export
 * 
 * @param {Object} options the information about the update-set to be send to the pipeline
 * @param {Console} logger a logger to be used
 * @param {Object} job job object
 * @returns {Promise<void>}
*/
module.exports = async function (options, logger = console) {
    const self = this;
    let config = {};
    let error;

    const step = (message, error) => {
        return self.addStep(console, config, `${path.basename(__filename).split('.')[0]}.export : ${message}`, error);
    };

    try {

        // setup job
        const { result, host: buildOnHost } = await new ExeJob({ name: 'projectSetup' }, options, logger);

        // job configuration
        config = result.config;

        const runId = result.runId;

        // update the buildOnHost information (findByIdAndUpdate)
        await self.db.run.update({ _id: runId, buildOnHost });

        // export files from master job
        await new ExeJob({ name: 'exportFilesFromMaster', host: buildOnHost }, runId, logger);

        // export update-set job
        await new ExeJob({ name: 'exportUpdateSet', host: buildOnHost }, runId, logger);

        // clean up directory 
        let run = await self.db.run.get(runId);
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
