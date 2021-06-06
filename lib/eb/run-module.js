

module.exports = async function (job, options, logger = console, done = async () => { }, started = async () => { }) {

    const { name, background } = job;
    const self = this;

    logger.log(`Module Start : '${name}'`);

    let dynamicModule;

    if (name in self.modules) {
        dynamicModule = self.modules[name];
    } else {
        throw new Error(`Module '${name}' not found.`);
    }

    const out = { result: undefined, error: undefined };

    if (background) {
        try {
            await started({ result: 'BACKGROUND-JOB-IN-PROGRESS' });

            try {
                out.result = await dynamicModule.call(self, options, logger, job);
            } catch (e) {
                out.result = undefined;
                out.error = e;
                logger.error(`BACKGROUND JOB ERROR: Job '${job.name}' (${job._id}) failed with: ${e.message || e}`);
                logger.error(e);
            }
        } catch (e) {
            out.result = undefined;
            out.error = e;
            logger.error(`BACKGROUND JOB Setup ERROR: Job'${job.name}' (${job._id}) failed with: ${e.message || e}`);
            logger.error(e);
        }
    } else {
        try {
            out.result = await dynamicModule.call(self, options, logger, job);

        } catch (e) {
            out.error = e;
            logger.error(`PROMISE JOB ERROR: Job '${job.name}' (${job._id}) failed with: ${e.message || e}`);
            logger.error(e);
        }
    }
    logger.log(`Module End : '${name}'`);
    return done(out);
};
