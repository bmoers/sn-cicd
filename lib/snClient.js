const SnRestClient = require("sn-rest-client"),
    ObjectAssignDeep = require('object-assign-deep'),
    Promise = require('bluebird');

module.exports = function ({
    tableApi,
    host_name,
    proxy,
    client_id,
    clientSecret,
    access_token,
    refresh_token,
    debug,
    silent,
    jar
} = {
        tableApi: false,
        debug: false,
        silent: true,
        jar: false
}) {

    const client = new SnRestClient({
        host_name: host_name,
        proxy: proxy,
        client_id: client_id,
        client_secret: clientSecret,
        access_token: access_token,
        refresh_token: refresh_token,
        debug: debug,
        silent: silent,
        jar: jar
    });

    const promiseFor = Promise.method(function (condition, action, value) {
        if (!condition(value))
            return value;
        return action(value).then(promiseFor.bind(null, condition, action));
    });

    /**
     * Expose the host name of the current REST client
     *
     * @returns {String} the HostName of the client
     */
    const getHostName = () => {
        return host_name;
    };


    const tableApiFunctions = () => {

        /**
         * Get User information by userId (user_name field)
         *
         * @param {String} userId
         * @returns {Promise}
         */
        const getUserById = (userId, pageCallBack) => {
            return client.get({
                url: 'api/now/table/sys_user',
                qs: {
                    'sysparm_fields': 'sys_id, name, email',
                    'sysparm_limit': 1,
                    'sysparm_query': `user_name=${userId}`
                }
            }, pageCallBack);
        };


        /**
         *  Get the details of an UpdateSet
         *
         * @param {String} updateSetSysId
         * @returns {Promise}
         */
        const getUpdateSetDetails = (updateSetSysId) => {
            return client.get({
                url: `api/now/table/sys_update_set/${updateSetSysId}`,
                qs: {
                    sysparm_display_value: 'all',
                    sysparm_exclude_reference_link: true,
                    sysparm_fields: 'sys_id, application.name, application.scope, name, description, state, remote_sys_id, sys_created_by, sys_created_on, sys_updated_by, sys_updated_on'
                }
            }).then((result) => {
                if (!result.length) 
                    throw Error(`UpdateSet not found with ID ${updateSetSysId}`);
                
                var us = result[0];
                const updateSet = {
                    sys_id: us.sys_id.value,
                    appName: us['application.name'].display_value,
                    scopeName: us['application.scope'].display_value,
                    scopeId: us['application.scope'].value
                };

                ['name', 'description', 'state', 'remote_sys_id', 'sys_created_by', 'sys_created_on', 'sys_updated_by', 'sys_updated_on'].forEach((field) => {
                    updateSet[field] = us[field].value;
                });
                return updateSet;
                
            });
        };


        /**
         *  Extract files of an UpdateSet
         *
         * @param {String} updateSetSysId the sys_id of the updateSet
         * @param {Promise} pageCallBack each page results are passed to this inner-callback
         * @returns
         */
        const getUpdateSetFiles = (updateSetSysId, pageCallBack) => {
            return client.get({
                url: 'api/now/table/sys_update_xml',
                qs: {
                    sysparm_query: `update_set.base_update_set=${updateSetSysId}^ORupdate_set=${updateSetSysId}^ORDERBYsys_recorded_at`,
                    sysparm_fields: 'action,name,payload,update_set,sys_id',
                    sysparm_display_value: false,
                    sysparm_exclude_reference_link: true,
                    sysparm_limit: 50
                }
            }, pageCallBack);
        };


        /**
         * Get all ATF Test which are assigned to a TestSuite. <br>
         * This is used to exclude the test from the ATF runs to avoid running twice.
         * 
         * @returns {Promise}
         */
        const getAllTestInSuites = (pageCallBack) => {
            return client.get({
                url: 'api/now/table/sys_atf_test_suite_test',
                qs: {
                    sysparm_query: 'test_suite.active=true^test.active=true',
                    sysparm_fields: 'test',
                    sysparm_exclude_reference_link: true
                }
            }, pageCallBack);
        };



        /**
         *  Get records from a table. <br>
         *  This is mainly used to extract the 'master' files from the production environment.
         *
         * @param {*} {tableName, options}
         * @param {*} pageCallBack
         * @returns {Promise} each page results are passed to this inner-callback
         */
        const getFilesFromTable = ({tableName, options}, pageCallBack) => {

            const settings = ObjectAssignDeep({
                qs: {
                    sysparm_query: null,
                    sysparm_display_value: false,
                    active: null,
                    sysparm_fields: null
                },
                autoPagination: true
            }, options || {}, {
                url: `api/now/table/${tableName}`
            });

            return client.get(settings, pageCallBack);
        };


        /**
         * Change the state of an UpdateSet
         *
         * @param {*} updateSetSysId the sys_id of the update set
         * @param {*} state the state value (must be a valid choice list value)
         * @returns {Promise}
         */
        const setUpdateSetStatus = (updateSetSysId, state) => {
            return client.put({
                url: `api/now/table/sys_update_set/${updateSetSysId}`
            }, {
                state: state
            });
        };


        /**
         * Deploy an UpdateSet to a Target Environment
         *
         * @param {*} updateSetSysId the sys_id of the update set
         * @param {*} targetHostName the FQDN of the target host
         * @returns {Promise}
         */
        const deployUpdateSet = (updateSetSysId, targetHostName) => {

            const sleepMs = 1000;
            let body;

            return promiseFor(function (nextOptions) {
                return (nextOptions);
            }, (options) => {
                console.log('Request: ', options.url);

                // create a new copy of the defaults client
                return new SnRestClient({
                    proxy: proxy,
                    client_id: client_id,
                    client_secret: clientSecret,
                    access_token: access_token,
                    refresh_token: refresh_token,
                    debug: debug,
                    silent: silent,
                    jar: jar
                }).run(options).then((response) => {

                    let location;
                    if (response.statusCode === 202) { // job created, come back to url
                        location = response.headers.location;
                        if (!location)
                            throw Error('Location header not found');

                        options.method = 'GET';
                        options.url = location;
                        return options;
                    }

                    options = null;
                    body = response.body;

                }).catch((e) => {

                    let location;
                    if (e.statusCode === 303) { // follow redirect
                        location = e.response.headers.location;
                        if (!location)
                            throw e;

                        delete options.body;
                        options.method = 'GET';
                        options.url = location;

                        //console.log(`Redirect to: ${options.url}`);

                        return options;

                    } else if (e.statusCode === 304) { // job running, wait and come back
                        location = e.response.headers.location;
                        if (!location)
                            throw e;

                        delete options.body;
                        options.method = 'GET';
                        options.url = location;

                        //console.log(`Redirect to: ${options.url}`);
                        console.log(`Job in progress. Wait for ${sleepMs} ms ...`);
                        return Promise.delay(sleepMs).then(() => {
                            return options;
                        });
                    } else {
                        throw e;
                    }

                });
            }, {
                rawResponse: true,
                followRedirect: false,
                method: 'POST',
                url: host_name.concat('/api/swre/v1/cicd/deploy'),
                body: {
                    'updateSetSysId': updateSetSysId,
                    'targetEnvironment': targetHostName
                }
            }).then(function () {
                return body.result;
            });
        };

        return {

            get: (options) => {
                return client.get(options);
            },

            getUserById: getUserById,

            getUpdateSetDetails: getUpdateSetDetails,

            getUpdateSetFiles: getUpdateSetFiles,

            getAllTestInSuites: getAllTestInSuites,

            getFilesFromTable: getFilesFromTable,

            getHostName: getHostName,

            setUpdateSetStatus: setUpdateSetStatus,

            deployUpdateSet: deployUpdateSet
        };


    };

    const scriptedApiFunctions = () => {


        /**
         * Get User information by userId (user_name field)
         *
         * @param {String} userId value of the user_name field
         * @returns {Promise}
         */
        const getUserById = (userId, pageCallBack) => {
            return client.get({
                url: `api/swre/v1/cicd/user/${userId}`
            }, pageCallBack);
        };


        /**
         *  Get the details of an UpdateSet
         *
         * @param {String} updateSetSysId
         * @returns {Promise}
         */
        const getUpdateSetDetails = (updateSetSysId) => {
            return client.get({
                url: `api/swre/v1/cicd/updateset/${updateSetSysId}`,
                qs: {
                    sysparm_display_value: 'all',
                    sysparm_fields: 'sys_id, application.name, application.scope, name, description, state, remote_sys_id, sys_created_by, sys_created_on, sys_updated_by, sys_updated_on'
                }
            }).then((result) => {
                if (!result.length)
                    throw Error(`UpdateSet not found with ID ${updateSetSysId}`);

                var us = result[0];
                const updateSet = {
                    sys_id: us.sys_id.value,
                    appName: us['application.name'].display_value,
                    scopeName: us['application.scope'].display_value,
                    scopeId: us['application.scope'].value
                };

                ['name', 'description', 'state', 'remote_sys_id', 'sys_created_by', 'sys_created_on', 'sys_updated_by', 'sys_updated_on'].forEach((field) => {
                    updateSet[field] = us[field].value;
                });
                return updateSet;

            });
        };


        /**
         *  Extract files of an UpdateSet
         *
         * @param {String} updateSetSysId the sys_id of the updateSet
         * @param {Promise} pageCallBack each page results are passed to this inner-callback
         * @returns
         */
        const getUpdateSetFiles = (updateSetSysId, pageCallBack) => {
            return client.get({
                url: `api/swre/v1/cicd/updatesetfiles/${updateSetSysId}`,
                qs: {
                    sysparm_fields: 'action, name, payload, update_set, sys_id'
                }
            }, pageCallBack);
        };


        /**
         * Get all ATF Test which are assigned to a TestSuite. <br>
         * This is used to exclude the test from the ATF runs to avoid running twice.
         * 
         * @returns {Promise}
         */
        const getAllTestInSuites = (pageCallBack) => {
            return client.get({
                url: `api/swre/v1/cicd/alltestinsuites`
            }, pageCallBack);
        };


        /**
         * 
         * 
         * @returns {Promise}
         */
        const executeTest = ({ id, runnerId }, pageCallBack) => {
            return client.post({
                url: `/api/swre/v1/cicd/atf/test`,
                body: {
                    id: id,
                    runnerId: runnerId
                }
            }, pageCallBack);
        };

        /**
         * 
         * 
         * @returns {Promise}
         */
        const executeSuite = ({ id, runnerId }, pageCallBack) => {
            return client.post({
                url: `/api/swre/v1/cicd/atf/suite`,
                body: {
                    id: id,
                    runnerId: runnerId
                }
            }, pageCallBack);
        };

        /**
         * 
         * 
         * @returns {Promise}
         */
        const getExecutionTracker = (id, pageCallBack) => {
            return client.get({
                url: `/api/swre/v1/cicd/atf/track/${id}`
            }, pageCallBack);
        };

        /**
         * 
         * 
         * @returns {Promise}
         */
        const getSuiteResults = (id, pageCallBack) => {
            return client.get({
                url: `/api/swre/v1/cicd/atf/suite//${id}`
            }, pageCallBack);
        };

        /**
         * 
         * 
         * @returns {Promise}
         */
        const getTestResults = (id, pageCallBack) => {
            return client.get({
                url: `/api/swre/v1/cicd/atf/test/${id}`
            }, pageCallBack);
        };

        /**
         *  Get records from a table. <br>
         *  This is mainly used to extract the 'master' files from the production environment.
         *
         * @param {*} {tableName, options}
         * @param {*} pageCallBack
         * @returns {Promise} each page results are passed to this inner-callback
         */
        const getFilesFromTable = ({tableName, options}, pageCallBack) => {

            const settings = ObjectAssignDeep({
                qs: {
                    sysparm_query: null,
                    sysparm_display_value: false,
                    active: null,
                    sysparm_fields: null
                },
                autoPagination: true
            }, options || {}, {
                url: `api/swre/v1/cicd/file/${tableName}`
            });

            return client.get(settings, pageCallBack);
        };

        /*
        const getApplicationFilesMeta = (applicationSysId, pageCallBack) => {
            return client.get({
                url: `api/swre/v1/cicd/applcationmeta/${updateSetSysId}`,
                qs: {
                    sysparm_fields: 'sys_id, sys_class_name'
                }
            }, pageCallBack);
        };
        */

        /**
         * Change the state of an UpdateSet
         *
         * @param {*} updateSetSysId the sys_id of the update set
         * @param {*} state the state value (must be a valid choice list value)
         * @returns {Promise}
         */
        const setUpdateSetStatus = (updateSetSysId, state) => {
            return client.patch({
                url: `api/swre/v1/cicd/updatesetstatus/${updateSetSysId}`
            }, {
                state: state
            });
        };


        /**
         * Deploy an UpdateSet to a Target Environment
         *
         * @param {*} updateSetSysId the sys_id of the update set
         * @param {*} targetHostName the FQDN of the target host
         * @returns {Promise}
         */
        const deployUpdateSet = (updateSetSysId, targetHostName) => {
            
            const WAIT_DELAY_MS = 1000; // delay in milliseconds for the update-set status to check.
            const MAX_WAIT_SEC = 5 * 60; // time in seconds for the update-set to be completed;
            const MAX_ITERATIONS = (MAX_WAIT_SEC * 1000 / WAIT_DELAY_MS);

            let body, iterations = 0;

            return promiseFor(function (nextOptions) {
                 return (nextOptions);
            }, (options) => {
                console.log('Request: ', options.url);

                // create a new copy of the defaults client
                return new SnRestClient({
                        proxy: proxy,
                        client_id: client_id,
                        client_secret: clientSecret,
                        access_token: access_token,
                        refresh_token: refresh_token,
                        debug: debug,
                        silent: silent,
                        jar: jar
                }).run(options).then((response) => {

                    let location;
                    if (response.statusCode === 202) { // job created, come back to url
                        location = response.headers.location;
                        if (!location)
                            throw Error('Location header not found');
                        
                        options.method = 'GET';
                        options.url = location;
                        return options;
                    }
                    
                    options = null;
                    body = response.body;
                    
                }).catch((e) => {
                    
                    let location;
                    if (e.statusCode === 303) { // follow redirect
                        location = e.response.headers.location;
                        if (!location)
                            throw e;
                        
                        delete options.body;
                        options.method = 'GET';
                        options.url = location;

                        //console.log(`Redirect to: ${options.url}`);

                        return options;
                    
                    } else if (e.statusCode === 304) { // job running, wait and come back
                        // cont iterations
                        iterations++;

                        location = e.response.headers.location;
                        if (!location)
                            throw e;

                        if (iterations > MAX_ITERATIONS) {
                            throw Error("Commit did not complete in SNOW after " + MAX_WAIT_SEC + " seconds.");
                        }
                        
                        delete options.body;
                        options.method = 'GET';
                        options.url = location;

                        //console.log(`Redirect to: ${options.url}`);
                        console.log(`Job in progress. Wait for ${WAIT_DELAY_MS} ms ...`);
                        return Promise.delay(WAIT_DELAY_MS).then(() => {
                            return options;
                        });
                    } else {
                        throw e;
                    }
                    
                });
            }, {
                rawResponse: true,
                followRedirect: false,
                method: 'POST',
                url: host_name.concat('/api/swre/v1/cicd/deploy'),
                body: {
                    'updateSetSysId': updateSetSysId,
                    'targetEnvironment': targetHostName
                }
            }).then(function () {
                return {
                    result: body.result,
                    seconds: (iterations * WAIT_DELAY_MS / 1000)
                };
            });
        };


        return {

            get: (options) => {
                return client.get(options);
            },
            
            getUserById: getUserById,

            getUpdateSetDetails: getUpdateSetDetails,

            getUpdateSetFiles: getUpdateSetFiles,

            getAllTestInSuites: getAllTestInSuites,

            executeSuite: executeSuite,

            executeTest: executeTest,

            getExecutionTracker: getExecutionTracker,

            getSuiteResults: getSuiteResults,

            getTestResults: getTestResults,

            getFilesFromTable: getFilesFromTable,

            //getApplicationFilesMeta: getApplicationFilesMeta,

            getHostName: getHostName,

            setUpdateSetStatus: setUpdateSetStatus,

            deployUpdateSet: deployUpdateSet
        };


    };

    if (tableApi) {
        return tableApiFunctions();
    } else {
        return scriptedApiFunctions();
    }

};