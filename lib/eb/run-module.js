
var Promise = require('bluebird');


module.exports = function (job, options, logger = console, done = () => { }, started = () => { }) {

    const { name, background } = job;
    const self = this;

    logger.log(`Starting module: '${name}'`);

    return Promise.try(() => {
        if (name in self.modules)
            return self.modules[name];

        throw new Error(`Module '${name}' not found.`);

    }).then((dynamicModule) => {
        const out = { result: undefined, error: undefined };

        if (background) {

            return new Promise((resolve) => {
                // start background job
                logger.log(`STARTING BACKGROUND JOB '${name}'`);

                dynamicModule.call(self, options, logger, job).then((result) => {
                    out.result = result;
                }).catch((e) => {
                    out.result = undefined;
                    out.error = e;
                    logger.error(`BACKGROUND JOB ERROR: Job '${job.name}' (${job._id}) failed with: ${e.message || e}`);
                    logger.error(e);
                }).then(() => {
                    return done(out);
                });

                // resolve and don't wait for the job to complete
                resolve();
            }).then(() => {
                out.result = 'BACKGROUND-JOB-IN-PROGRESS';
            }).catch((e) => {
                out.result = undefined;
                out.error = e;
                logger.error(`BACKGROUND JOB Setup ERROR: Job'${job.name}' (${job._id}) failed with: ${e.message || e}`);
                logger.error(e);
            }).then(() => {
                return started(out);  
            });

        } else {

            return dynamicModule.call(self, options, logger, job).then((result) => {
                out.result = result;
            }).catch((e) => {
                out.error = e;
                logger.error(`PROMISE JOB ERROR: Job '${job.name}' (${job._id}) failed with: ${e.message || e}`);
                logger.error(e);
            }).then(() => {
                return done(out);
            });
        }

    });

};
