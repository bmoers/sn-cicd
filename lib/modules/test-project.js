const Promise = require('bluebird');
const path = require("path");
const puppeteer = require('puppeteer');
const uui = require('uuid/v4');

const MAX_WAIT_SEC = 600; // time in seconds for the test to complete
const WAIT_DELAY_MS = 500; // delay in mseconds for the test status to check.

const promiseFor = Promise.method(function (condition, action, value) {
    if (!condition(value))
        return value;
    return action(value).then(promiseFor.bind(null, condition, action));
});

module.exports = function ({config, id}) {
    const self = this;

    let client;

    //console.log('TEST PROJECT', id, config);

    const step = (message, error) => {
        return self.addStep(config, `${path.basename(__filename).split('.')[0]} : ${message}`, error);
    };

    const waitForTestInSnowToComplete = function (testExecutionID) {

        console.log(`Waiting for ATF Test to complete. ExecutionTrackerId: ${testExecutionID}`);

        var executionTracker,
            maxIter = (MAX_WAIT_SEC * 1000 / WAIT_DELAY_MS),
            iter = 0,
            delay = 500;

        return promiseFor(function (state) {
            return (state < 2);
        }, function () {

            return client.getExecutionTracker(testExecutionID).then(function (result) {
                iter++;

                executionTracker = result[0];
                var state = parseInt(executionTracker.state.value || 2, 10);
                console.log('\tSTATE is: ', executionTracker.state.display_value, '#', iter);

                if (iter >= maxIter) {
                    throw {
                        statusCode: -999,
                        error: {
                            error: {
                                message: "Test did not complete in SNOW after " + MAX_WAIT_SEC + " seconds."
                            }
                        }
                    };
                } else if (state <= 1) {
                    return Promise.delay(delay).then(function () {
                        return state;
                    });
                } else {
                    return state;
                }

            }).then(function (state) {
                return state;
            });

        }, 0).then(function () {
            // only the result field is of interest
            return JSON.parse(executionTracker.result.value);
        });
    };

    const getTestResultsFromSnow = function (testResultObject) {
        return Promise.try(() => {
            if (testResultObject.result_id)
                return client.getTestResults(testResultObject.result_id);
            
            return client.getSuiteResults(testResultObject.test_suite_result_id);
            
        }).then(function (result) {
            var testExecutionResult = result[0];
            return testExecutionResult;
        });
    };


    const openTestRunner = function (host, atf) {
        
        const runnerId = uui();
        console.log(`Opening Puppeteer Test Runner with ID: ${runnerId}`);

        return Promise.try(() => {
            return puppeteer.launch({
                ignoreHTTPSErrors: true,
                headless: (process.env.CICD_ATF_SHOW_BROWSER_WINDOW === 'true') ? false : true,
                executablePath: process.env.CICD_ATF_BROWSER
            });
        }).then((browser) => {
            return browser.newPage().then((page) => {

                return page.setExtraHTTPHeaders({
                    'Authorization': 'Bearer '.concat((process.env.CICD_ATF_TEST_USER_TOKEN) ? process.env.CICD_ATF_TEST_USER_TOKEN : atf.credentials.oauth)
                }).then(() => {
                    return page.setUserAgent(`Mozilla/5.0 (Windows; U; Windows NT 6.1; rv:2.2) Gecko/20110201 ${runnerId}`);
                }).then(() => {
                    return page.setViewport({
                        width: 1400,
                        height: 800
                    });
                }).then(() => {
                    //console.log(`${host}/nav_to.do?uri=atf_test_runner.do%3fsysparm_scheduled_tests_only%3dfalse%26sysparm_nostack%3dtrue'`)
                    return page.goto(`${host}/nav_to.do?uri=atf_test_runner.do%3fsysparm_scheduled_tests_only%3dfalse%26sysparm_nostack%3dtrue'`, {
                        waitUntil: 'networkidle2'
                    });
                });

            }).then(() => ({
                browser: browser,
                runnerId: runnerId
            }));
        }).delay(1000).then(({browser, runnerId}) => {
            console.log(`Browser started and ready to be used. RunnerID: ${runnerId}`);
            return {
                browser: browser,
                runnerId: runnerId
            };
        });
    };

    const closeTestRunner = function (runner) {
        console.log(`Closing Test Runner`);
        return Promise.try(() => {
            if (runner)
                return runner.close();
        });
    };

    return Promise.try(() => {
        client = self.getClient(config);
    }).then(() => {
        return self.db.us.get({_id: id});
    }).then((us) => {
        if (us.testJob == 'running')
            throw new Error('Job is already running');
        
        us.testJob = 'running';
        return self.db.us.update(us).then(() => us);

    }).then((us) => {
        
        const suiteResults = Promise.map(us.build.test.suites || [], function (suiteId) {
            //console.log("RUN SUITE: ", suiteId);
            return openTestRunner(config.host.name, us.config.atf).then(({browser, runnerId}) => {
                let testResultObject = {};
                return client.executeSuite({
                        id: suiteId,
                        runnerId: runnerId
                    }).then((result) => {
                    return result[0].executionId;
                }).then((executionId) => {
                    return waitForTestInSnowToComplete(executionId).then((testResult) => {
                        testResultObject = testResult;
                    });
                }).finally(() => {
                    return closeTestRunner(browser);
                }).then(() => {
                    return getTestResultsFromSnow(testResultObject);
                });
            });

        });

        const testResults = Promise.map(us.build.test.tests || [], function (testId) {
            
            return openTestRunner(config.host.name, us.config.atf).then(({browser, runnerId}) => {
                let testResultObject = {};
                return client.executeTest({
                        id: testId,
                        runnerId: runnerId
                    }).then((result) => {
                     return result[0].executionId;
                }).then((executionId) => {
                    return waitForTestInSnowToComplete(executionId).then((testResult) => {
                        testResultObject = testResult;
                    });
                }).finally(() => {
                    return closeTestRunner(browser);
                }).then(() => {
                    return getTestResultsFromSnow(testResultObject);
                });
            });
        });

        return Promise.all([suiteResults, testResults]).then((allResults) => {
            return {
                suiteResults: allResults[0],
                testResults: allResults[1]
            };
        }).then((testResults) => {
            us.testResults = testResults;
            return self.db.us.update(us);
        }).finally(() => {
            us.testJob = 'complete';
            return self.db.us.update(us);
        });
        
    });

};