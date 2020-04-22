const Promise = require('bluebird');
const path = require("path");
const puppeteer = require('puppeteer');
const uui = require('uuid/v4');
const assign = require('object-assign-deep');

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
module.exports = function ({ id, commitId, on }, logger = console, { host }) {
    const self = this;
    let config = {};
    let run, client, test, testOnHostName, normalBuildRun;
    const slack = self.getSlack();

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
        }).then(() => {
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
            testResultObject.result = result[0];
            return testResultObject;
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
            const testResultObject = { passed: false, id: {}, result: {} };
            return client.executeSuite({
                id: suiteId,
                runnerId: runnerId
            }).then((result) => {
                return result[0].executionId;
            }).then((executionId) => {
                if (!executionId)
                    return step('WARN: ATF job not started. Make sure ATF test runner is enabled. (sn_atf.runner.enabled)');

                return waitForTestInSnowToComplete(executionId).then((completed) => {
                    testResultObject.passed = completed.passed;
                    testResultObject.id = completed.result;
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
            const testResultObject = { passed: false, id: {}, result: {} };
            return client.executeTest({
                id: testId,
                runnerId: runnerId
            }).then((result) => {
                return result[0].executionId;
            }).then((executionId) => {
                if (!executionId)
                    return step('WARN: ATF job not started. Make sure ATF test runner is enabled. (sn_atf.runner.enabled)');

                return waitForTestInSnowToComplete(executionId).then((completed) => {
                    testResultObject.passed = completed.passed;
                    testResultObject.id = completed.result;
                });
            }).finally(() => {
                return closeTestRunner(browser);
            }).then(() => {
                return getTestResultsFromSnow(testResultObject);
            });
        });
    };

    return Promise.try(() => {
        return self.db.run.findOne({ commitId });
    }).then((_run) => {

        if (!_run)
            throw Error(`Run not found with id ${commitId}`);

        run = _run;

        testOnHostName = (on || run.config.host.name || '').toLowerCase().replace(/\/$/, "");
        normalBuildRun = (testOnHostName == run.config.host.name);

        config = assign({}, run.config);
        config.host.name = testOnHostName;

        return self.db.test.findOne({
            _id: id
        }).then((_test) => {
            if (!_test)
                throw new Error('Test job not found');

            test = assign(_test, {
                passed: null,
                onHost: testOnHostName,
                state: 'requested',
                start: Date.now(),
                end: -1,
                results: {
                    suiteResults: [],
                    testResults: []
                },
                standardRun: normalBuildRun
            });
            return self.db.test.update(test);
        });


    }).then(() => {
        return step(`Testing updateSet  '${run.config.updateSet.sys_id}' on '${testOnHostName}' (${normalBuildRun ? 'BUILD-RUN' : 'INDEPENDENT-TEST-RUN'})`);
    }).then(() => {
        client = self.getClient(config);
    }).then(() => {

        // as ATF run in sequence in Service-Now
        return Promise.try(() => {
            if (normalBuildRun)
                return run.build.test.suites;
            return self.getApplicationTestSuites(config).map((suite) => {
                return suite.sysId;
            });
        }).then((suites) => {
            test.suites = suites || [];
            if (test.suites.length)
                return step(`Suites to be executed ${suites.join(',')}`);
        }).then(() => {
            return Promise.try(() => {
                if (normalBuildRun)
                    return run.build.test.tests;
                return self.getApplicationTests(config).then((tests) => {

                    if (tests && tests.length) { // get all tests which are assigned to a Suite

                        // safe sys_id's of the whole list first
                        tests = tests.map((test) => test.sysId);

                        return client.getAllTestInSuites().then((files) => {
                            var assignedTests = files.reduce((prev, file) => {
                                return prev.concat(file.test);
                            }, []);

                            // remove all test from the config which are part of a Suite
                            return tests.filter((test) => {
                                return assignedTests.indexOf(test) === -1;
                            });
                        });
                    }
                    return [];
                });
            });
        }).then((tests) => {
            test.tests = tests || [];
            if (test.tests.length)
                return step(`Tests to be executed ${tests.join(',')}`);
        }).then(() => {
            if (!normalBuildRun) {
                return slack.message(`*${run.config.application.name} › ${run.config.updateSet.name} › #${run.sequence}*\nATF Execution\n\nGoing to execute ${test.suites.length > 0 ? `${test.suites.length} suite${test.suites.length > 1 ? 's' : ''}` : 'NO suite'} and ${test.tests.length > 0 ? `${test.tests.length} test${test.tests.length > 1 ? 's' : ''}` : 'NO tests'} for update set <${self.link(config.host.name, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`)}|${config.updateSet.name}> on <${config.host.name}|${config.host.name}>\n\n<${run.config.application.docUri}|details>`);
            }
        }).then(() => {
            return Promise.each(test.suites, (suiteId) => {
                return executeSuite(suiteId).then((suiteResult) => {

                    test.results.suiteResults.push(suiteResult.result);

                    return self.db.test.update(test).then(() => {
                        if (!suiteResult.passed)
                            throw Error(`Suite Failed at ${suiteId} `);
                    });
                });
            });
        }).then(() => {
            return Promise.each(test.tests, (testId) => {
                return executeTest(testId).then((testResult) => {

                    test.results.testResults.push(testResult.result);

                    return self.db.test.update(test).then(() => {
                        if (!testResult.passed)
                            throw Error(`Test Failed at ${testId} `);
                    });
                });
            });
        });
    }).then(() => {
        test.state = 'complete';
        test.passed = true;
    }).catch((e) => {
        test.state = 'failed';
        test.passed = false;
        return step(`TEST FAILED`, e);
    }).finally(() => {
        test.end = Date.now();
        return self.db.test.update(test).then(() => {
            if (!normalBuildRun) {

                const text = `*${run.config.application.name} › ${run.config.updateSet.name} › #${run.sequence}*\nATF Execution\n\nTest ${test.passed ? 'PASSED' : 'FAILED'} for update set <${self.link(config.host.name, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`)}|${config.updateSet.name}>\n on <${config.host.name}|${config.host.name}>.\nPlease check the <${config.application.docUri}|test results>`;
                if (test.passed)
                    return slack.build.complete(text);
                return slack.build.failed(text);
            }

            return self.db.run.findOne({
                _id: test.runId
            }).then((run) => {
                if (run) {
                    run.buildResults['test'] = test.passed;
                    if (!test.passed)
                        run.buildPass = false;
                    run.testId = test._id;
                    return self.db.run.update(run);
                }
            });
        });

    });

};


/*
return self.db.test.findOne({
    runId: run._id,
    on: testOnHostName
}).then((_test) => {
    if (_test) {
        if (_test.state == 'requested')
            throw new Error('Job is already requested');

        test = _test;
    }
    //return step(`Testing updateSet '${config.updateSet.sys_id}' on '${config.host.name}'`);

}).then(() => { // testing the update set
    if (test) {
        test.prevRun = test.prevRun || [];
        test.prevRun.push(assign({}, {
            id: test.id,
            state: test.state,
            start: test.start,
            end: test.end,
            results: test.results,
            error: test.error
        }));

        test.id = id;
        test.state = 'requested';
        test.start = Date.now();
        test.results = null;
        return self.db.test.update(test);
    }
    return self.db.test.insert({
        runId: run._id,
        usId: run.usId,
        appId: run.appId,
        commitId: run.commitId,
        id: id,
        on: testOnHostName,
        state: 'requested',
        start: Date.now(),
        end: -1,
        results: null,
        prevRun: []
    }).then((_test) => {
        test = _test;
    });
});
*/
