const SnRestClient = require("sn-rest-client"),
    ObjectAssignDeep = require('object-assign-deep'),
    Promise = require('bluebird');

module.exports = function ({
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
        const getUpdateSetDetails = (updateSetSysId, pageCallBack) => {
            return client.get({
                url: `api/now/table/sys_update_set/${updateSetSysId}`,
                qs: {
                    sysparm_display_value: 'all',
                    sysparm_exclude_reference_link: true,
                    sysparm_fields: 'sys_id, application.name, application.scope, name, description, state, remote_sys_id, sys_created_by, sys_created_on, sys_updated_by, sys_updated_on'
                }
            }, pageCallBack);
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

            getUserById: getUserById,

            getUpdateSetDetails: getUpdateSetDetails,

            getUpdateSetFiles: getUpdateSetFiles,

            getAllTestInSuites: getAllTestInSuites,

            getFilesFromTable: getFilesFromTable,

            getHostName: getHostName,

            setUpdateSetStatus: setUpdateSetStatus,

            deployUpdateSet: deployUpdateSet,

            client : client
        };


    };

    return tableApiFunctions();
    
};