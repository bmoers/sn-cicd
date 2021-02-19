
const Promise = require('bluebird');
const puppeteer = require('puppeteer');
const { v4: uuidv4 } = require('uuid');

const MAX_WAIT_SEC = 600; // time in seconds for the test to complete
const WAIT_DELAY_MS = 500; // delay in mseconds for the test status to check.


module.exports = function ({ on: testOnHostName, client, maxWaitSec = MAX_WAIT_SEC, waitDelayMs = WAIT_DELAY_MS, logger = console }) {


    if(!testOnHostName){
        throw Error('Target host name not specified')
    }

    if(!client){
        throw Error('rest client not specified')
    }

    const promiseFor = Promise.method(function (condition, action, value) {
        if (!condition(value))
            return value;
        return action(value).then(promiseFor.bind(null, condition, action));
    });

    const waitForTestInSnowToComplete = function (testExecutionID) {

        var executionTracker,
            maxIter = (maxWaitSec * 1000 / waitDelayMs),
            iter = 0,
            delay = 2000;

        logger.info(`Waiting for ATF Test to complete. ExecutionTrackerId: ${testExecutionID}`);

        return Promise.try(() => {
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
                                    message: "Test did not complete in SNOW after " + maxWaitSec + " seconds."
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

            }, 0).then(function (state) {
                // only the result field is of interest
                return {
                    passed: (state == 2),
                    result: JSON.parse(executionTracker.result.value)
                };
            });
        });
    };

    const getTestResultsFromSnow = function (testResultObject) {
        return Promise.try(() => {
            if (testResultObject.id.result_id)
                return client.getTestResults(testResultObject.id.result_id);

            return client.getSuiteResults(testResultObject.id.test_suite_result_id);

        }).then(function (result) {
            testResultObject.result = result;
            return testResultObject;
        });
    };

    const openTestRunner = function (host) {

        const runnerId = uuidv4();

        logger.info(`Opening Puppeteer Test Runner with ID: ${runnerId} on '${host}'`)
        return Promise.try(() => {
            return puppeteer.launch({
                ignoreHTTPSErrors: true,
                headless: (process.env.CICD_ATF_SHOW_BROWSER_WINDOW === 'true') ? false : true,
                executablePath: process.env.CICD_ATF_BROWSER,
                args: ['--no-sandbox', '--disable-dev-shm-usage']
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

        }).delay(1000).then(({ browser, runnerId }) => {
            logger.info(`Browser started and ready to be used. RunnerID: ${runnerId}`)
            return {
                browser: browser,
                runnerId: runnerId
            };
        });
    };

    const closeTestRunner = function (runner) {

        return Promise.try(() => {
            return logger.info(`Closing Test Runner`);
        }).then(() => {
            if (runner)
                return runner.close();
        });
    };

    const executeSuite = function (suiteId) {
        if(!suiteId)
            throw Error("Suite ID is mandatory")

        return openTestRunner(testOnHostName).then(({
            browser,
            runnerId
        }) => {
            const testResultObject = { passed: false, id: {}, result: {} };
            return client.executeSuite({
                id: suiteId,
                runnerId: runnerId
            }).then((result) => {
                return result[0].executionId;
            }).then((executionId) => {
                if (!executionId)
                    throw Error('WARN: ATF job not started. Make sure ATF test runner is enabled. (sn_atf.runner.enabled)');

                return waitForTestInSnowToComplete(executionId).then((completed) => {
                    testResultObject.passed = completed.passed;
                    testResultObject.id = completed.result;
                });
            }).catch((e) => {
                logger.error(e);
            }).finally(() => {
                return closeTestRunner(browser);
            }).then(() => {
                return getTestResultsFromSnow(testResultObject);
            });
        });
    };

    const executeTest = function (testId) {
        if(!testId)
            throw Error("Test ID is mandatory")
        return openTestRunner(testOnHostName).then(({
            browser,
            runnerId
        }) => {
            const testResultObject = { passed: false, id: {}, result: {} };
            return client.executeTest({
                id: testId,
                runnerId: runnerId
            }).then((result) => {
                return result[0].executionId;
            }).then((executionId) => {
                if (!executionId)
                    throw Error('WARN: ATF job not started. Make sure ATF test runner is enabled. (sn_atf.runner.enabled)');

                return waitForTestInSnowToComplete(executionId).then((completed) => {
                    testResultObject.passed = completed.passed;
                    testResultObject.id = completed.result;
                });
            }).catch((e) => {
                logger.error(e);
            }).finally(() => {
                return closeTestRunner(browser);
            }).then(() => {
                return getTestResultsFromSnow(testResultObject);
            });
        });
    };


    return {
        executeSuite,
        executeTest
    }
}

