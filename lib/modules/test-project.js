const Promise = require('bluebird');
const path = require("path");
const puppeteer = require('puppeteer');
const uui = require('uuid/v4');

const MAX_WAIT_SEC = 600; // time in seconds for the test to complete
const WAIT_DELAY_MS = 500; // delay in mseconds for the test status to check.

/**
 * Run ATF tests, called from server.
 * Mapped to: /build/test
 *
 * @param {Object} runId id of the current run
 * @param {Console} logger a logger to be used
 * @param {Object} job job object
 * @returns {Promise<UpdateSet>}  the related update set
*/
module.exports = function (runId, logger = console, { host }) {
    const self = this;
    let config = {};
    let run, client;

    const promiseFor = Promise.method(function (condition, action, value) {
        if (!condition(value))
            return value;
        return action(value).then(promiseFor.bind(null, condition, action));
    });

    const step = (message, error) => {
        return self.addStep(logger, config, `${path.basename(__filename).split('.')[0]} : ${message}`, error);
    };

    const waitForTestInSnowToComplete = function (testExecutionID) {

        var executionTracker,
            maxIter = (MAX_WAIT_SEC * 1000 / WAIT_DELAY_MS),
            iter = 0,
            delay = 2000;

        return Promise.try(() => {
            return step(`Waiting for ATF Test to complete. ExecutionTrackerId: ${testExecutionID}`);
        }).then(()=>{
            return promiseFor(function (state) {
                return (state < 2);
            }, function () {

                return client.getExecutionTracker(testExecutionID).then(function (result) {
                    iter++;

                    executionTracker = result[0];
                    var state = parseInt(executionTracker.state.value || 2, 10);
                    logger.info('test-project :', 'ATF state is: ', executionTracker.state.display_value, '#', iter, `wait ${delay}ms`);

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


    const openTestRunner = function (host) {
        
        const runnerId = uui();
        

        return Promise.try(() => {
            return step(`Opening Puppeteer Test Runner with ID: ${runnerId}`);
        }).then(() => {
            return puppeteer.launch({
                ignoreHTTPSErrors: true,
                headless: (process.env.CICD_ATF_SHOW_BROWSER_WINDOW === 'true') ? false : true,
                executablePath: process.env.CICD_ATF_BROWSER
            });
        }).then((browser) => {

            const m = host.match(/(?:http[s]?:\/\/)([^\.]*)([^:\/]*)/i);
            const varName = `CICD_ATF_TEST${((m) ? `_${m[1].toUpperCase()}` : '')}_USER`;

            const username = process.env[`${varName}_NAME`] || process.env.CICD_ATF_TEST_USER_NAME;
            const password = process.env[`${varName}_PASSWORD`] || process.env.CICD_ATF_TEST_USER_PASSWORD;

            return browser.newPage().then((page) => {

                const authorization = (process.env.CICD_ATF_TEST_USER_TOKEN) ? 'Bearer '.concat(process.env.CICD_ATF_TEST_USER_TOKEN) : 'Basic '.concat(Buffer.from(`${username}:${password}`).toString('base64'));

                return page.setExtraHTTPHeaders({
                    'Authorization': authorization
                }).then(() => {
                    // get a session cookie without being redirected to SAML endpoint
                    return page.goto(`${host}/api/now/table/sys_user/0`, {
                        waitUntil: 'networkidle2'
                    });
                }).then(() => {
                    page.close();
                });

            }).then(() => {
                return browser.newPage().then((page) => {
                    return page.setViewport({
                        width: 1400,
                        height: 1600
                    }).then(() => {
                        return browser.userAgent().then((agent) => {
                            return page.setUserAgent(`${agent} ${runnerId}`);
                        });
                    }).then(() => {
                        if (!process.env.CICD_ATF_TEST_USER_TOKEN) { // get a valid cookie
                            return page.goto(`${host}/login.do?user_name=${username}&sys_action=sysverb_login&user_password=${password}`, {
                                waitUntil: 'networkidle2'
                            });
                        }
                    }).then(() => {
                        return page.goto(`${host}/atf_test_runner.do?sysparm_nostack=true`, {
                            waitUntil: 'networkidle2'
                        });
                    });
                });
            
            }).then(() => ({
                browser: browser,
                runnerId: runnerId
            }));
            
        }).delay(1000).then(({browser, runnerId}) => {
            return step(`Browser started and ready to be used. RunnerID: ${runnerId}`).then(() => ({
                browser: browser,
                runnerId: runnerId
            }));
        });
    };

    const closeTestRunner = function (runner) {
        
        return Promise.try(() => {
            return step(`Closing Test Runner`);
        }).then(() => {
            if (runner)
                return runner.close();
        });
    };

    const executeSuite = function (suiteId) {
        return openTestRunner(config.host.name, config.atf).then(({
            browser,
            runnerId
        }) => {
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
    };
    
    const executeTest = function (testId) {
        return openTestRunner(config.host.name, config.atf).then(({
            browser,
            runnerId
        }) => {
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
    };

    return Promise.try(() => {
        return self.db.run.get(runId).then((_run) => {
            if (!_run)
                throw Error(`Run not found with id ${runId}`);
        
            if (_run.testJob == 'running')
                throw new Error('Job is already running');
            
            run = _run;
            config = _run.config;
            run.testJob = 'running';
            return self.db.run.update(run);
        });
    }).then(() => {
        client = self.getClient(config);
    
    }).then(() => {
        // as ATF run in sequence in Sercie-Now
        return Promise.map(run.build.test.suites || [], (suiteId) => {
            return executeSuite(suiteId);
        }).then((suiteResults) => {
            return Promise.map(run.build.test.tests || [], function (testId) {
                return executeTest(testId);
            }).then((testResults) => {
                return {
                    suiteResults,
                    testResults
                };
            });
        });
        /*
        const suiteResults = Promise.map(run.build.test.suites || [], function (suiteId) {
            return executeSuite(suiteId);
        });

        const testResults = Promise.map(run.build.test.tests || [], function (testId) {
            return executeTest(testId);

        });

        return Promise.all([suiteResults, testResults]).then((allResults) => {
            return {
                suiteResults: allResults[0],
                testResults: allResults[1]
            };
        })
        */
    }).then((testResults) => {
        run.testResults = testResults;
        return self.db.run.update(run);
    }).finally(() => {
        run.testJob = 'complete';
        return self.db.run.update(run);
    });

};