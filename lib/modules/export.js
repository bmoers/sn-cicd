const Promise = require('bluebird');
const path = require('path');
const EventBusJob = require('../eb/job');

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
module.exports = function (options, logger = console) {
    const self = this;
    let config = {},
        error;

    const step = (message, error) => {
        return self.addStep(console, config, `${path.basename(__filename).split('.')[0]}.export : ${message}`, error);
    };

    return Promise.try(() => {
        //return step(`CICD export; ${options.application} ${options.updateSet}`);

    }).then(() => {
        return new EventBusJob({ name: 'projectSetup' }, options, logger).then(({ result, host }) => {
            config = result.config;
            return self.db.run.get(result.runId).then((run) => {
                run.buildOnHost = host;
                return self.db.run.update(run);
            }).then(() => ({
                host, runId: result.runId
            }));
        });
    }).then(({ host, runId }) => {
        return Promise.try(() => {
            return new EventBusJob({ name: 'exportFilesFromMaster', host }, runId, logger);
        }).then(() => {
            return new EventBusJob({ name: 'exportUpdateSet', host }, runId, logger);
        });
    }).catch((e) => {
        error = e;
        return Promise.try(() => {
            return self.setProgress(config, this.build.FAILED);
        }).then(() => {
            return step('failed', e);
        }).then(() => {
            logger.error(e);
        });
    }).finally(() => {
        return self.finalizeRun(config, error);
    });
};
