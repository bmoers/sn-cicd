/* eslint-disable no-loop-func */
const Promise = require('bluebird');
const path = require("path");
const assign = require('object-assign-deep');

const TestExec = require('../test-execute');



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

    const arrayChunks = (array, chunkSize) => Array(Math.ceil(array.length / chunkSize)).fill().map((_, index) => index * chunkSize).map((begin) => array.slice(begin, begin + chunkSize));

    const step = (message, error) => {
        return self.addStep(logger, config, `${path.basename(__filename).split('.')[0]} : ${message}`, error);
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

        const testExecutor = new TestExec({ on: testOnHostName, client, logger, maxTimeoutSec: process.env.CICD_ATF_EXECUTION_TIMEOUT_SEC })

        // as ATF run in sequence in Service-Now
        return Promise.try(async () => {

            if (normalBuildRun) {

                const suitesInUpdateSet = run.build.test.suites || [];
                if (suitesInUpdateSet.length == 0)
                    return suitesInUpdateSet;

                /*
                    check if the suites in the update set
                    are dependent by a parent.

                    e.g. 'c1' and 'a' are in the update set (see structure below) 
                    in this case only 'a' should be executed as otherwise 'c1' will be 
                    executed 2 times.
                */

                // create a tree structure of the existing suites
                const suites = await self.getApplicationTestSuites(config);
                let parentSuites = suites.filter((suite) => !suite.parent);

                const tree = parentSuites.reduce((out, root) => {
                    out[root.sysId] = [];
                    return out;
                }, {});
                // walk suites top (no parent) down
                while (parentSuites.length) {
                    const suitesWithParent = suites.filter((suite) => {
                        return parentSuites.find((parent) => parent.sysId == suite.parent)
                    });
                    //console.log('suitesWithParent', suitesWithParent)
                    suitesWithParent.forEach((suite) => {
                        tree[suite.sysId] = tree[suite.sysId] || [];
                        tree[suite.sysId].push(suite.parent);
                        if (tree[suite.parent]) {
                            tree[suite.sysId].push(...tree[suite.parent]);
                        }
                        tree[suite.sysId] = [...new Set(tree[suite.sysId])];

                    });
                    parentSuites = suitesWithParent;
                }
                /*
                tree = {
                    'a': [],
                    'b1': ['a'],
                    'c1': ['a','b1'],
                    'b2': ['a'],
                    'c2': ['a','b2'],
                }
                */

                // find common parent suites

                const includeSuites = [];
                // tree sorted by the depth. root on top, deepest on bottom
                const sortedTreeKeys = Object.keys(tree).sort((a, b) => tree[a].length - tree[b].length);
                //console.log('sortedTreeKeys', sortedTreeKeys);

                sortedTreeKeys.forEach((key) => {
                    const suiteInUpdateSet = suitesInUpdateSet.find((suite) => suite == key);
                    if (suiteInUpdateSet) {
                        const parents = tree[key];
                        // include the suite only if none of its parents are included yet
                        const inParent = includeSuites.find((u) => parents.includes(u));
                        if (!inParent) {
                            includeSuites.push(suiteInUpdateSet)
                        } else {
                            console.log(`suite '${suiteInUpdateSet}' ignored as already covered by parent '${inParent}'`);
                        }
                    }
                })
                return includeSuites;
            }

            const suites = await self.getApplicationTestSuites(config);
            return suites.filter((suite) => !suite.parent).map((suite) => {
                return suite.sysId;
            });
        }).then((suites) => {
            test.suites = suites || [];
            if (test.suites.length)
                return step(`Suites to be executed ${suites.join(',')}`);

        }).then(() => {
            return Promise.try(() => {
                if (normalBuildRun) {
                    // validate if tests still active
                    const tests = run.build.test.tests || [];
                    const chunks = arrayChunks(tests, 25);
                    return Promise.mapSeries(chunks, async (chunk) => {
                        const param = {
                            tableName: 'sys_atf_test',
                            options: { qs: { sysparm_query: `active=true^sys_idIN${chunk.join(',')}`, sysparm_fields: 'sys_id' } }
                        };
                        const files = await client.getFilesFromTable(param);
                        return files.map(function (file) {
                            return file.sys_id
                        });
                    }).then((filesPerChunks) => {
                        return filesPerChunks.flat(1);
                    });
                }
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
                return testExecutor.executeSuite(suiteId).then((suiteResult) => {

                    const result = Array.isArray(suiteResult.result) ? suiteResult.result : [suiteResult.result];
                    test.results.suiteResults.push(...result);

                    return self.db.test.update(test).then(() => {
                        if (!suiteResult.passed)
                            throw Error(`Suite Failed at ${suiteId} `);
                    });
                });
            });
        }).then(() => {
            return Promise.each(test.tests, (testId) => {
                return testExecutor.executeTest(testId).then((testResult) => {

                    const result = Array.isArray(testResult.result) ? testResult.result : [testResult.result];
                    test.results.testResults.push(...result);

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

