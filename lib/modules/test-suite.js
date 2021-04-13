/* eslint-disable no-loop-func */
const Promise = require('bluebird');
const assign = require('object-assign-deep');

const TestExec = require('../test-execute');

/**
 * Run ATF tests, called from server.
 * Mapped to: /build/test/app
 *
 * @param {Object} runId id of the current run
 * @param {Console} logger a logger to be used
 * @param {Object} job job object
 * @returns {Promise<UpdateSet>}  the related update set
*/
module.exports = async function ({ id, on: testOnHostName }, logger = console, { host }) {
    const self = this;


    if (!testOnHostName)
        throw new Error('Test job not found');

    let test = await self.db.test.findOne({
        _id: id
    });

    if (!test)
        throw new Error('Test job not found');

    test = assign(test, {
        passed: null,
        onHost: testOnHostName,
        state: 'requested',
        start: Date.now(),
        end: -1,
        results: {
            suiteResults: [],
            testResults: []
        },
        standardRun: false
    });

    await self.db.test.update(test);

    const client = self.getClient({
        host: {
            name: testOnHostName
        }
    });

    try {
        const testExecutor = new TestExec({ on: testOnHostName, client, logger, maxTimeoutSec: process.env.CICD_ATF_EXECUTION_TIMEOUT_SEC });

        await Promise.each(test.suites, (suiteId) => {
            return testExecutor.executeSuite(suiteId).then((suiteResult) => {

                const result = Array.isArray(suiteResult.result) ? suiteResult.result : [suiteResult.result];
                test.results.suiteResults.push(...result);

                return self.db.test.update(test).then(() => {
                    if (!suiteResult.passed)
                        throw Error(`Suite Failed at ${suiteId} `);
                });
            });
        });

        await Promise.each(test.tests, (testId) => {
            return testExecutor.executeTest(testId).then((testResult) => {

                const result = Array.isArray(testResult.result) ? testResult.result : [testResult.result];
                test.results.testResults.push(...result);

                return self.db.test.update(test).then(() => {
                    if (!testResult.passed)
                        throw Error(`Test Failed at ${testId} `);
                });
            });
        });

        test.state = 'complete';
        test.passed = true;
    } catch (e) {
        test.state = 'failed';
        test.passed = false;
        logger.warn('TEST FAILED', e);
    }
    
    test.end = Date.now();

    return self.db.test.update(test);

};

