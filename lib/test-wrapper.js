const EventBusJob = require('./eb/job');
const EbQueueJob = require('./eb/queue-job');
const get = require('./get');
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
            testOnHostName = on.toLowerCase().replace(/\/$/, "");
            if (!testOnHostName.startsWith('https://'))
                testOnHostName = `https://${testOnHostName}`;
        } else {
            testOnHostName = run.config.host.name.toLowerCase().replace(/\/$/, "");
        }

        // ensure test can not run on production
        if (!get(['config', 'master', 'host', 'name'], run) && process.env.CICD_ATF_RUN_ON_PRODUCTION == 'false') {
            if (run.config.master.host.name == testOnHostName)
                throw Error(`Execution of test on master not allowed. Change CICD_ATF_RUN_ON_PRODUCTION`);
        }

        return self.db.test.findOne({
            commitId,
            on: testOnHostName,
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
                return new EventBusJob({ name: 'testProject', background: true }, { id: test._id, commitId, on: testOnHostName }, logger).then(() => {
                    return { commitId, id: test._id };
                });
            });
        });

    });
};

/**
 * get test results
 *
 */
module.exports.get = function ({ commitId, id }) {
    const self = this;
    return self.db.run.findOne({
        commitId
    }).then((run) => {
        if (!run)
            throw Error(`Run not found with commitId ${commitId}`);

        return self.db.test.findOne({
            commitId,
            _id: id
        }).then((test) => {
            if (test && test.state != 'requested') {
                return test;
            }
            throw Error('304');
        });
    });
};
