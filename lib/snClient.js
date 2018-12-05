const SnRestClient = require("sn-rest-client"),
    assign = require('object-assign-deep'),
    Promise = require('bluebird');

module.exports = function ({
    hostName,
    proxy = {
        host : null, strictSSL:false
    },
    username, password,
    clientId, clientSecret, accessToken, refreshToken,
    debug = false,
    silent = true,
    jar = false,
    appPrefix = 'devops'
}) {

    const client = new SnRestClient({
        hostName: hostName,
        proxy: proxy,
        auth: {
            clientId: clientId,
            clientSecret: clientSecret,
            accessToken: accessToken,
            refreshToken: refreshToken,

            username: username,
            password: password
        },
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
        return hostName;
    };

    


    /**
     * Get User information by userId (user_name field)
     *
     * @param {String} userId value of the user_name field
     * @returns {Promise}
     */
    const getUserById = (userId, pageCallBack) => {
        return client.get({
            url: `api/${appPrefix}/cicd/user/${userId}`
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
            url: `api/${appPrefix}/cicd/updateset/${updateSetSysId}`,
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
            url: `api/${appPrefix}/cicd/updateset_files/${updateSetSysId}`,
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
            url: `api/${appPrefix}/cicd/test_in_suites`
        }, pageCallBack);
    };


    /**
     * 
     * 
     * @returns {Promise}
     */
    const executeTest = ({ id, runnerId }, pageCallBack) => {
        return client.post({
            url: `/api/${appPrefix}/cicd/atf/test`,
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
            url: `/api/${appPrefix}/cicd/atf/suite`,
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
            url: `/api/${appPrefix}/cicd/atf/track/${id}`
        }, pageCallBack);
    };

    /**
     * 
     * 
     * @returns {Promise}
     */
    const getSuiteResults = (id, pageCallBack) => {
        return client.get({
            url: `/api/${appPrefix}/cicd/atf/suite//${id}`
        }, pageCallBack);
    };

    /**
     * 
     * 
     * @returns {Promise}
     */
    const getTestResults = (id, pageCallBack) => {
        return client.get({
            url: `/api/${appPrefix}/cicd/atf/test/${id}`
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
    const getFilesFromTable = ({
        tableName,
        options
    }, pageCallBack) => {
        const settings = assign({
            qs: {
                sysparm_query: undefined,
                sysparm_display_value: undefined,
                active: undefined,
                sysparm_fields: undefined
            },
            autoPagination: true
        }, options || {}, {
            url: `api/${appPrefix}/cicd/file/${tableName}`
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
        return client.patch({
            url: `api/${appPrefix}/cicd/updateset_status/${updateSetSysId}`
        }, {
            state: state
        });
    };


    /**
     * Deploy an UpdateSet to a Target Environment
     *
     * @param {*} updateSetSysId the sys_id of the update set
     * @param {*} targetHostName the FQDN of the target host
     * @param {clientId, clientSecret, accessToken, refreshToken, username, password} targetAuth (optional) the Oauth Bearer of the target env
     * @returns {Promise}
     */
    const deployUpdateSet = (updateSetSysId, targetHostName, targetAuth) => {

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
                auth: options.auth,
                debug: debug,
                silent: silent
            }).run(options).then((response) => {

                let location;
                if (response.statusCode === 202) { // job created, come back to url
                    location = response.headers.location;
                    if (!location)
                        throw Error('Location header not found');

                    options.method = 'GET';
                    options.url = location;
                    options.auth = targetAuth || options.auth;
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
                    options.auth = targetAuth || options.auth;
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
                    options.auth = targetAuth || options.auth;

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
            auth: {
                clientId: clientId,
                clientSecret: clientSecret,
                accessToken: accessToken,
                refreshToken: refreshToken,

                username: username,
                password: password
            },
            rawResponse: true,
            followRedirect: false,
            method: 'POST',
            url: `${hostName}/api/${appPrefix}/cicd/deploy`,
            body: {
                'updateSetSysId': updateSetSysId,
                'targetEnvironment': {
                    host: targetHostName,
                    username: targetAuth.username,
                    password: targetAuth.password
                }
            }
        }).then(function () {
            return {
                result: body.result,
                seconds: (iterations * WAIT_DELAY_MS / 1000)
            };
        }).catch((e) => {
            if (409 == e.statusCode) { // 'Update Set Preview Problems' || 'Data Loss Warning'
                //console.warn('deployUpdateSet 409 error', e);
                const result = e.error.result || {};
                throw result.error || {};
            }
            throw e;
        });
    };

    const exportUpdateSet = (updateSetSysId) => {
        return client.get({
            url: `api/${appPrefix}/cicd/export_updateset/${updateSetSysId}`,
            rawResponse: true
        }).then((response) => ({
            name: `sys_update_set_${updateSetSysId}.xml`,
            content: response.body
        }));
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

        getHostName: getHostName,

        setUpdateSetStatus: setUpdateSetStatus,

        deployUpdateSet: deployUpdateSet,

        exportUpdateSet: exportUpdateSet,

        client: client
    };


    
};