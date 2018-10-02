/* exported CiCdAtf */
/* global sn_atf, gs, GlideXMLDocument, sn_ws_err, Class, TestExecutorAjax, GlideRecord, JSON */

/**
 * ATF wrapper used in REST api
 * 
 * @module CiCdAtf
 * @class 
 * @author SRZXBX - Boris Moers
 * @requires global.module:sys_script_include.SreLogger
 * @requires sn_ws_err.module:sys_script_include.BadRequestError
 * @requires global.module:sys_script_include.TestExecutorAjax
 * @memberof global.module:sys_script_include
 */
var CiCdAtf = Class.create();

CiCdAtf.prototype = /** @lends global.module:sys_script_include.CiCdAtf.prototype */ {

    /**
     * Constructor
     * 
     * @param {any} request
     * @param {any} response
     * @returns {undefined}
     */
    initialize: function (request, response) {
        var self = this;

        self.request = request;
        self.response = response;
    },

    /**
     * Get param from URL path
     * 
     * @param {any} paramName
     * @param {any} callback
     * @returns {undefined}
     */
    getPathParam: function (paramName, callback) {
        var self = this,
            out = (paramName in self.request.pathParams) ? self.request.pathParams[paramName] : null;

        if (self.isFunction(callback)) {
            return callback(out);
        } else {
            return out;
        }
    },

    /**
     * Get param form URL query argument
     * 
     * @param {any} paramName
     * @param {any} callback
     * @returns {undefined}
     */
    getQueryParam: function (paramName, callback) {
        var self = this,
            out = (paramName in self.request.queryParams) ? (function () {
                var value = self.request.queryParams[paramName];
                if (Array.isArray(value)) {
                    return (value.length === 1) ? value[0] : value;
                } else {
                    return value;
                }
            })() : null;

        if (self.isFunction(callback)) {
            return callback(out);
        } else {
            return out;
        }
    },


    /**
     * Get the testrunner from the current user.
     * This requires the testrunner window to be opened in a browser first.
     * 
     * @returns {any} testRunnerSessionId
     */
    getTestRunnerSessionId: function () {
        var testRunnerSessionId = null;

        var existingRunner = new GlideRecord("sys_atf_agent");
        existingRunner.addQuery("user", gs.getUserID());
        existingRunner.addQuery("status", "online");
        //existingRunner.addQuery("session_id", new GlideChecksum(gs.getSessionID()).getMD5());
        //otherSessionRunner.addQuery("session_id","!=", new GlideChecksum(gs.getSessionID()).getMD5());
        existingRunner.addQuery("type", "manual");
        existingRunner.orderByDesc("last_checkin");
        existingRunner.setLimit(1);
        existingRunner._query();
        if (existingRunner._next()) {
            testRunnerSessionId = existingRunner.getValue('session_id');
        }
        return testRunnerSessionId;
    },


    /**
     * Execute a Test-Suite<br>
     * 
     * mapped to POST /api/swre/v1/va/atf/suite
     * @returns {any} out
     */
    executeSuite: function () {
        var self = this,
            suiteId,
            out = {
                executionId: null
            },
            need_browser = false,
            testRunnerSessionId = null;

        var requestBody = self.request.body;
        if (!requestBody || !requestBody.hasNext())
            return new sn_ws_err.BadRequestError('initialize: no body found');

        var body = requestBody.nextEntry();
        suiteId = body.suiteId || null;
        if (gs.nil(suiteId))
            return new sn_ws_err.BadRequestError('initialize: suiteId property not found');

        var gr = new GlideRecord('sys_atf_test_suite');
        if (!gr.get(suiteId)) {
            return new sn_ws_err.BadRequestError("Could not find the Test suite with id: " + suiteId);
        }

        out.url = gs.getProperty('glide.servlet.uri').concat(gr.getLink(true));
        out.name = gr.getDisplayValue();

        need_browser = sn_atf.AutomatedTestingFramework.doesSuiteHaveUITests(suiteId);
        if (need_browser) {
            testRunnerSessionId = self.getTestRunnerSessionId();
            if (gs.nil(testRunnerSessionId)) {
                return new sn_ws_err.BadRequestError("This TestSuite requires an active Test Runner to be available.");
            }
        }

        /*

       
        // Check if there are any UI steps in the test suite
        if (testSuiteSysId) 
        need_browser = sn_atf.AutomatedTestingFramework.doesSuiteHaveUITests(testSuiteSysId);

        var existingRunner = new GlideRecord("sys_atf_agent");
        existingRunner.addQuery("user", gs.getUserID());
        existingRunner.addQuery("status", "online");
        existingRunner.addQuery("session_id",sessionId); 
        existingRunner.addQuery("type", "manual");
        existingRunner.orderBy("browser_name");
        existingRunner.query();

        // make sure that this url is open on the nodejs server
        https://swissre1.service-now.com/nav_to.do?uri=atf_test_runner.do%3fsysparm_scheduled_tests_only%3dtrue%26sysparm_nostack%3dtrue


        // These test runners are displayed without "current session"
        var otherSessionRunner = new GlideRecord("sys_atf_agent");
        otherSessionRunner.addQuery("user", gs.getUserID());
        otherSessionRunner.addQuery("status", "online");
        otherSessionRunner.addQuery("session_id","!=", sessionId);
        otherSessionRunner.addQuery("type", "manual");
        otherSessionRunner.orderBy("browser_name");
        otherSessionRunner.query();

        sysparm_ajax_processor_ut_test_suite_id:cff24b0ddbc4df00432cfc600f961932
        sysparm_ajax_processor_test_runner_session_id:0f2f7b7dd321e059f102ead69e7dbd13

        // suite
        var executor = new sn_atf.UserTestSuiteExecutor();
		executor.setTestSuiteSysId(utTestSuiteId);
		executor.setTestRunnerSessionId(testRunnerSessionId);
		return executor.start();


        // test
        return new sn_atf.ExecuteUserTest()
		.setTestRecordSysId(utTestSysId)
		.setTestRunnerSessionId(testRunnerSessionId)
        .start();
        
        */

        // execute suite
        out.executionId = new TestExecutorAjax((function () {
            var params = {
                'sysparm_name': 'true',
                'sysparm_ajax_processor_ut_test_suite_id': suiteId,
                'sysparm_ajax_processor_test_runner_session_id': testRunnerSessionId
            };
            return {
                /**
                 * Description
                 * 
                 * @param {any} name
                 * @returns {MemberExpression}
                 */
                getParameter: function name(name) {
                    return params[name];
                }
            };
        })(), new GlideXMLDocument(), '').process();

        /*
        var executor = new sn_atf.UserTestSuiteExecutor();
        executor.setTestSuiteSysId(suiteId);
        executor.setTestRunnerSessionId(testRunnerSessionId);
        out.executionId = executor.start();
        */
        return out;
    },

    /**
     * Tet Test-Suite results<br>
     * 
     * mapped to GET /api/swre/v1/va/atf/suite/{id}
     * @returns {any} out
     */
    getSuiteResults: function () {
        var self = this,
            out = {
                testResults: []
            };

        var suiteId = self.getPathParam('suiteId');

        var gr = new GlideRecord('sys_atf_test_suite_result');
        if (gr.get(suiteId)) {
            out.number = gr.getValue('number');
            out.status = gr.getValue('status');
            out.duration = gr.getValue('run_time');
            out.url = gs.getProperty('glide.servlet.uri').concat(gr.getLink(true));
            out.type = 'test_suite_result';

            var gRes = new GlideRecord('sys_atf_test_result');
            gRes.addQuery('parent', gr.getValue('sys_id'));
            gRes._query();
            while (gRes._next()) {
                out.testResults.push(self._getTestResultDetails(gRes.getValue('sys_id')));
            }
        }
        return out;
    },


    /**
     * Execute a single Test<br>
     * mapped to POST /api/swre/v1/va/atf/test
     * @returns {any} out
     */
    executeTest: function () {
        var self = this,
            testId,
            out = {
                executionId: null
            },
            need_browser = false,
            testRunnerSessionId = null;

        var requestBody = self.request.body;
        if (!requestBody || !requestBody.hasNext())
            return new sn_ws_err.BadRequestError('initialize: no body found');

        var body = requestBody.nextEntry();
        testId = body.testId || null;
        if (gs.nil(testId))
            return new sn_ws_err.BadRequestError('initialize: testId property not found');

        var gr = new GlideRecord('sys_atf_test');
        if (!gr.get(testId)) {
            return new sn_ws_err.BadRequestError("Could not find the Test suite with id: " + testId);
        }

        out.url = gs.getProperty('glide.servlet.uri').concat(gr.getLink(true));
        out.name = gr.getDisplayValue();

        need_browser = sn_atf.AutomatedTestingFramework.doesTestHaveUISteps(testId);
        if (need_browser) {
            testRunnerSessionId = self.getTestRunnerSessionId();
            if (gs.nil(testRunnerSessionId)) {
                return new sn_ws_err.BadRequestError("This Test requires an active Test Runner to be available.");
            }
        }

        // execute test
        out.executionId = new TestExecutorAjax((function () {
            var params = {
                'sysparm_ajax_processor_ut_test_id': testId,
                'sysparm_ajax_processor_test_runner_session_id': testRunnerSessionId
            };
            return {
                /**
                 * Description
                 * 
                 * @param {any} name
                 * @returns {MemberExpression}
                 */
                getParameter: function name(name) {
                    return params[name];
                }
            };
        })(), new GlideXMLDocument(), '').process();

        return out;
    },


    /**
     * Get Single Test Results<br>
     * mapped to GET /api/swre/v1/va/atf/test/{id}
     * @returns {any}
     */
    getTestResults: function () {
        var self = this;

        var testId = self.getPathParam('testId');

        return self._getTestResultDetails(testId);

    },

    /**
     * Get the execution state of a test run<br>
     * mapped to GET /api/swre/v1/va/atf/track/{id}
     * @returns {any}
     */
    getExecutionTrackerState: function () {
        var self = this;
        var id = self.getPathParam('executionId');
        var gr = new GlideRecord('sys_execution_tracker');
        gr.get(id);

        return {
            state: {
                value: gr.getValue('state'),
                display_value: gr.getDisplayValue('state')
            },
            result: {
                value: gr.getValue('result'),
                display_value: gr.getDisplayValue('result')
            },
            url: gs.getProperty('glide.servlet.uri').concat(gr.getLink(true))
        };

    },

    /**
     * convert test result to object
     * 
     * @param {any} sysId
     * @returns {any} out
     */
    _getTestResultDetails: function (sysId) {
        var self = this,
            out = {
                stepResults: []
            };

        var gr = new GlideRecord('sys_atf_test_result');
        if (gr.get(sysId)) {

            out.number = gr.getDisplayValue('test');
            out.status = gr.getValue('status');
            out.startTime = gr.getValue('start_time');
            out.endTime = gr.getValue('end_time');
            out.duration = gr.getValue('run_time');
            out.output = gr.getValue('output');
            out.type = 'test_result';
            out.url = gs.getProperty('glide.servlet.uri').concat(gr.getLink(true));

            var gRes = new GlideRecord('sys_atf_test_result_step');
            gRes.addQuery('test_result', gr.getValue('sys_id'));
            gRes.orderBy('step.order');
            gRes._query();
            while (gRes._next()) {
                out.stepResults.push({
                    order: parseInt(gRes.getElement('step.order').toString(), 10),
                    startTime: gRes.getValue('start_time'),
                    step: gRes.getDisplayValue('step'),
                    status: gRes.getValue('status'),
                    summary: gRes.getValue('summary'),
                    url: gs.getProperty('glide.servlet.uri').concat(gRes.getLink(true))
                });
            }
        }
        return out;
    },

    type: 'CiCdAtf'
};