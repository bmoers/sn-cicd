
const Promise = require('bluebird');
const puppeteer = require('puppeteer');
const { v4: uuidv4 } = require('uuid');

const MAX_TIMEOUT_SEC = 10 * 60; // time in seconds for the test to complete
const WAIT_DELAY_MS = 2000; // delay in milliseconds for the test status to check.
const NAVIGATION_TIMEOUT_MS = 60 * 1000; // time in milliseconds for a single page navigation to complete
const BROWSER_CLOSE_TIMEOUT_MS = 30 * 1000; // time in milliseconds granted to the browser to shut down gracefully


/*
 * Reads a numeric setting, falling back to fallbackValue for anything that is not a
 * whole positive number. Timeouts come straight from the environment, so they must not
 * be parsed with parseInt(): that reads '1h30m' as 1, which would abort every navigation
 * after a single millisecond. Number() rejects such values outright.
 */
const positiveIntOr = function (value, fallbackValue) {
    const parsed = Number(value);
    return (Number.isInteger(parsed) && parsed > 0) ? parsed : fallbackValue;
};

/*
 * Last resort when browser.close() does not return. Puppeteer spawns Chrome detached, so
 * it is the leader of its own process group and its renderer / zygote / GPU helpers are
 * separate PIDs. Killing only the leader would orphan those children - exactly the leak
 * this module is guarding against - so the whole group is signalled, the same way
 * puppeteer's own killChrome() does (node_modules/puppeteer/lib/Launcher.js).
 *
 * Note this deliberately uses process.kill() rather than child.kill(): the latter sets
 * child.killed, which makes puppeteer skip its own group kill on process exit.
 */
const killBrowserProcessGroup = function (browser) {
    try {
        const child = browser.process();
        if (!child || !child.pid || child.killed)
            return;

        if (process.platform === 'win32')
            child.kill('SIGKILL'); // no process groups on windows, puppeteer uses taskkill here
        else
            process.kill(-child.pid, 'SIGKILL');
    } catch (e) {
        // the process group is already gone, nothing left to do
    }
};


module.exports = function ({ on: testOnHostName, client, maxTimeoutSec = MAX_TIMEOUT_SEC, waitDelayMs = WAIT_DELAY_MS, logger = console }) {


    if(!testOnHostName){
        throw Error('Target host name not specified');
    }

    if(!client){
        throw Error('rest client not specified');
    }

    const promiseFor = Promise.method(function (condition, action, value) {
        if (!condition(value))
            return value;
        return action(value).then(promiseFor.bind(null, condition, action));
    });

    const waitForTestInSnowToComplete = function (testExecutionID) {

        const waitDelay = parseInt(waitDelayMs || WAIT_DELAY_MS, 10);
        const maxWait = parseInt(maxTimeoutSec || MAX_TIMEOUT_SEC, 10);
        const maxIter = (maxWait * 1000 / waitDelay);
        let executionTracker;
        let iter = 0;

        logger.info(`test-execute : Waiting ${maxWait} seconds for ATF Test to complete. ExecutionTrackerId: ${testExecutionID}`);

        return Promise.try(() => {
            return promiseFor(function (state) {
                return (state < 2);
            }, function () {

                return client.getExecutionTracker(testExecutionID).then(function (result) {
                    iter++;

                    executionTracker = result[0];
                    var state = parseInt(executionTracker.state.value || 2, 10);
                    logger.info(`test-execute : ATF state is: ${executionTracker.state.display_value} # ${iter}/${maxIter}`);

                    if (iter >= maxIter) {
                        throw {
                            statusCode: -999,
                            error: {
                                error: {
                                    message: `Test did not complete in SNOW after ${maxWait} seconds.`
                                }
                            }
                        };
                    } else if (state <= 1) {
                        return Promise.delay(waitDelay).then(function () {
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
        const navigationTimeout = positiveIntOr(process.env.CICD_ATF_NAVIGATION_TIMEOUT_MS, NAVIGATION_TIMEOUT_MS);

        logger.info(`test-execute : Opening Puppeteer Test Runner with ID: ${runnerId} on '${host}'`);
        return Promise.try(() => {
            return puppeteer.launch({
                ignoreHTTPSErrors: true,
                headless: (process.env.CICD_ATF_SHOW_BROWSER_WINDOW === 'true') ? false : true,
                executablePath: process.env.CICD_ATF_BROWSER,
                args: ['--no-sandbox', '--disable-dev-shm-usage']
            });
        }).then((browser) => {

            /*
             * The Chrome process exists from here on. Everything below runs inside a guarded
             * block so that ANY failure closes the browser before the error is rethrown -
             * otherwise the handle is lost and the Chrome process is orphaned for good.
             * That lost handle was the root cause of the swap exhaustion in INC104096366.
             */
            return Promise.try(() => {

                const m = host.match(/(?:http[s]?:\/\/)([^.]*)([^:/]*)/i);
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
                            waitUntil: 'networkidle2',
                            timeout: navigationTimeout
                        });
                    }).finally(() => {
                        /*
                         * This throwaway auth page must never influence the outcome. A bluebird
                         * .finally handler that rejects REPLACES the original result, and
                         * page.close() can both reject ('Target closed') and - if Chrome dies
                         * between the close ack and the targetDestroyed event - never settle at
                         * all. Whatever happens here, browser.close() cleans the page up later.
                         */
                        return Promise.resolve(page.close())
                            .timeout(BROWSER_CLOSE_TIMEOUT_MS)
                            .catch(() => { });
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
                                    waitUntil: 'networkidle2',
                                    timeout: navigationTimeout
                                });
                            }
                        }).then(() => {
                            return page.goto(`${host}/atf_test_runner.do?sysparm_nostack=true`, {
                                waitUntil: 'networkidle2',
                                timeout: navigationTimeout
                            });
                        });
                    });

                });

            }).delay(1000).then(() => {
                logger.info(`test-execute : Browser started and ready to be used. RunnerID: ${runnerId}`);
                return {
                    browser: browser,
                    runnerId: runnerId
                };

            }).catch((e) => {
                logger.error(`test-execute : Failed to open Test Runner ${runnerId} on '${host}'. Closing the browser to not leak the Chrome process.`, e);
                return closeTestRunner(browser).then(() => {
                    throw e;
                });
            });
        });
    };

    const closeTestRunner = function (runner) {

        return Promise.try(() => {
            logger.info('test-execute : Closing Test Runner');

            if (!runner)
                return;

            // browser.close() can hang on an unresponsive Chrome - never let that block the job
            return Promise.resolve(runner.close()).timeout(BROWSER_CLOSE_TIMEOUT_MS);

        }).catch((e) => {
            /*
             * Closing must never reject: callers invoke this from .finally() and from the
             * error path of openTestRunner, where a cleanup error would mask the real one.
             */
            logger.error('test-execute : Browser did not close gracefully. Force killing the Chrome process group.', e);
            killBrowserProcessGroup(runner);
        });
    };

    const executeSuite = function (suiteId) {
        if(!suiteId)
            throw Error('Suite ID is mandatory');

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
            throw Error('Test ID is mandatory');
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
    };
};

