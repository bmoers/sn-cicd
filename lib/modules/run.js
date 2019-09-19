const Promise = require('bluebird');
const path = require("path");
const EventBusJob = require('../eb/job');

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
module.exports = function (options, logger = console) {
    const self = this;
    let config = {},
        error;

    const step = (message, error) => {
        return self.addStep(console, config, `${path.basename(__filename).split('.')[0]}.run : ${message}`, error);
    };

    return Promise.try(() => {
        //return step(`CICD Run. ${options.application} ${options.updateSet}`);

    }).then(() => {
        //console.log('options.runId', options.runId)
        return self.db.run.get(options.runId).then((run) => {
            if (run) {
                config = run.config;
                return self.db.us.update({ _id: run.usId, running: true }, true).then(() => {
                    return {
                        host: run.buildOnHost, runId: run._id
                    }
                });
            }

            return Promise.try(() => {
                return new EventBusJob({ name: 'projectSetup' }, options, logger);
            }).then(({ result, host }) => {
                config = result.config;
                return self.db.run.get(result.runId).then((run) => {
                    run.buildOnHost = host;
                    return self.db.run.update(run);
                }).then((run) => ({
                    host, runId: run._id
                }));
            });
        })

    }).then(({ host, runId }) => {
        return Promise.try(() => {
            return new EventBusJob({ name: 'runCollisionDetection', host }, runId, logger);
        }).then(({ result = {} }) => {

            const run = result;

            if (run.config.build.collisionDetection && run.collision.state != 'passed')
                return step(`Update set is causing conflicts on target environment. Review issues here: ${run.collision.remoteUpdateSetUrl}`);

            return Promise.try(() => {
                return new EventBusJob({ name: 'exportFilesFromMaster', host }, runId, logger);
            }).then(() => {
                return new EventBusJob({ name: 'exportUpdateSet', host }, runId, logger);
            }).then(() => {
                if (process.env.CICD_EMBEDDED_BUILD === 'true')
                    return new EventBusJob({ name: 'buildProject', host }, runId, logger);

                return step(`Embedded Build is disabled. Waiting for external Build Tool to run.`);
            });

        });

    }).catch((e) => {
        console.error(e);
        error = e;
        return Promise.try(() => {
            return self.setProgress(config, this.build.FAILED);
        }).then(() => {
            return step(`failed`, e);
        }).then(() => {
            console.error(e);
        });

    }).finally(() => {
        return self.finalizeRun(config, error);
    });
}
