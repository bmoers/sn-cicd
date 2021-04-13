
var Promise = require('bluebird');


module.exports = function (job, options, logger = console, done, started) {

    const { name, background } = job;
    const self = this;

    logger.log(`Starting module: ${name}`);
    /* 
    //return
    Promise.try(() => {
        if (name in self.modules)
            return self.modules[name];

        throw new Error(`Module ${name} not found.`);

    }).then((dynamicModule) => {
        
        if (background) {
            return new Promise((resolve) => {
                // in case of background, dont return the promise...
                logger.log(`STARTING BACKGROUND JOB '${name}'`);
                dynamicModule.call(self, options, logger, job).then((result) => {
                    logger.log(`BACKGROUND JOB '${name}' completed with: ${result}`);
                }).catch((e) => {
                    logger.error(`BACKGROUND JOB ERROR: Job '${name}'`, arguments[0], arguments[1], e);
                });
                resolve('BACKGROUND');
            });
        } else {
            logger.log(`STARTING PROMISE JOB '${name}'`);
            return dynamicModule.call(self, options, logger, job);
        }
    });
     */

    return Promise.try(() => {
        if (name in self.modules)
            return self.modules[name];

        throw new Error(`Module ${name} not found.`);

    }).then((dynamicModule) => {
        if (background) {

            return new Promise((resolve) => {
                // start background job
                logger.log(`STARTING BACKGROUND JOB '${name}'`);
                dynamicModule.call(self, options, logger, job).then((result) => {
                    job.result = result;
                }).catch((e) => {
                    job.error = e;
                    logger.error(`BACKGROUND JOB ERROR: Job '${name}'`, job, e);
                }).then(() => {
                    if (typeof done === 'function')
                        return done(job);
                });
                
                // resolve and dont wait for the job to complete
                job.result = 'BACKGROUND-JOB-IN-PROGRESS';
                resolve();
            }).catch((e) => {
                logger.error(`BACKGROUND JOB Setup ERROR: Job '${name}'`, job, e.error || e);
                job.error = e;
            }).then(() => {
                if (typeof started === 'function')    
                    return started(job);
            });

        } else {

            logger.log(`STARTING PROMISE JOB '${name}'`);
            return dynamicModule.call(self, options, logger, job).then((result) => {
                job.result = result;
            }).catch((e) => {
                logger.error(`PROMISE JOB ERROR: Job '${name}'`, job, e.error || e);
                job.error = e;
            }).then(() => {
                if (typeof done === 'function')
                    return done(job);
            });
        }

    });

    
};