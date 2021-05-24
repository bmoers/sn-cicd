const ExeJob = require('./eb/job');
const QueueJob = require('./eb/queue-job');
const get = require('./get');
const crypto = require('crypto');
/**
 * execute test
 * 
 */
module.exports.run = function ({ commitId, on }, logger = console) {
    const self = this;
    if (!commitId)
        throw Error('CommitID is mandatory');

    return self.db.run.findOne({
        commitId
    }).then((run) => {
        if (!run)
            throw Error(`Run not found with commitId ${commitId}`);

        let testOnHostName;
        if (on && on !== 'undefined') {
            testOnHostName = on.toLowerCase().replace(/\/$/, '');
            if (!testOnHostName.startsWith('https://'))
                testOnHostName = `https://${testOnHostName}`;
        } else {
            testOnHostName = run.config.host.name.toLowerCase().replace(/\/$/, '');
        }

        // exit in case ATF is disabled
        if (run.config.atf.enabled == false) {
            throw Error('Execution of test disabled. Change CICD_ATF_ENABLED and re-build app.');
        }

        // ensure test can not run on production
        if (get(['config', 'master', 'host', 'name'], run) && process.env.CICD_ATF_RUN_ON_PRODUCTION == 'false') {
            if (run.config.master.host.name == testOnHostName)
                throw Error('Execution of test on master not allowed. Change CICD_ATF_RUN_ON_PRODUCTION and re-build app.');
        }


        return self.db.test.findOne({
            commitId,
            onHost: testOnHostName,
            state: 'requested'
        }).then((test) => {
            if (test)
                throw new Error(`Test already requested for ${testOnHostName}`);

            return self.db.test.insert({
                state: 'requested',
                runId: run._id,
                usId: run.usId,
                appId: run.appId,
                commitId: run.commitId,
                ts: Date.now()
            }).then((test) => {
                return new QueueJob({ name: 'testProject', background: true, exclusiveId: run.appId }, { id: test._id, commitId, on: testOnHostName }, logger).then((job) => {
                    return { commitId, id: test._id, jobId: job._id };
                });
            });
        });

    });
};

module.exports.runApp = function ({ on, suites = [], tests = [] }, logger = console) {
    const self = this;

    const testOnHostName = (on && on !== 'undefined') ? on.toLowerCase().replace(/\/$/, '') : undefined;
    if (!testOnHostName)
        throw Error('target host name is mandatory');

    if (!Array.isArray(suites))
        throw Error(`suites must be an array: ${suites}`);

    if (!Array.isArray(tests))
        throw Error(`tests must be an array: ${tests}`);

    suites = suites.map((t) => t.trim()).filter((f) => (f));
    tests = tests.map((t) => t.trim()).filter((f) => (f));

    if (suites.length == 0 && tests.length == 0)
        throw Error('suites or tests must be an specified');

    return self.db.test.insert({
        state: 'requested',
        ts: Date.now(),
        suites,
        tests
    }).then((test) => {
        // use the suites & test information as key
        const exclusiveId = crypto.createHash('md5').update((suites || []).concat((tests || [])).join('')).digest('hex');
        return new QueueJob({ name: 'testSuite', background: true, exclusiveId }, { id: test._id, on: testOnHostName }, logger).then((job) => {
            return { id: test._id, jobId: job._id };
        });
    });
};
/**
 * get test results
 *
 */
module.exports.get = function ({ id }) {
    const self = this;
    return self.db.test.findOne({
        _id: id
    }).then(async (test) => {
        if (test && test.state != 'requested') {
            if (!test.appId)
                await self.db.test.delete(test);
            return test;
        }
        throw Error('304');
    });
};
