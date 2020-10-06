const SnRestClient = require("sn-rest-client"),
    assign = require('object-assign-deep'),
    Promise = require('bluebird');

module.exports = function ({
    hostName,
    proxy = {
        host: null, strictSSL: false
    },
    username, password,
    clientId, clientSecret, accessToken, refreshToken,
    debug = false,
    silent = true,
    jar = false,
    appPrefix = 'devops'
}) {

    // specify the min version of the CICD integration app to be installed in ServiceNow
    const CICD_INTEGRATION_APP_MIN_VERSION = [1, 4, 0];

    const DEFAULT_RETRY = 10;
    const DEFAULT_DELAY = 5000;

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


    const checkVersion = ({ hostName, auth = { username: undefined, password: undefined } }) => {

        
        return new SnRestClient({
            hostName,
            auth,
            proxy: proxy,
            debug: debug,
            silent: silent
        }).get({
            url: `api/${appPrefix}/cicd/version`,
            retry: DEFAULT_RETRY,
            delay: DEFAULT_DELAY
        }).then((appVersion) => {
            if (!appVersion)
                throw Error(`CICD Integration App has no version tag and needs to be upgraded to version ${CICD_INTEGRATION_APP_MIN_VERSION.join('.')} on environment '${hostName}'`);;
            /*
                Major must match
                Minor must be same or higher
                Patch is ignored
            */
            const err = Error(`CICD Integration App is on version ${appVersion.join('.')} and needs to be upgraded to version ${CICD_INTEGRATION_APP_MIN_VERSION.join('.')} on environment '${hostName}'`);
            if (appVersion[0] != CICD_INTEGRATION_APP_MIN_VERSION[0]) {
                throw err;
            }
            if (appVersion[1] < CICD_INTEGRATION_APP_MIN_VERSION[1]) {
                throw err;
            }
            console.log(`API Version Check Passed. CICD Integration App on '${hostName}' is on version ${appVersion.join('.')}`);
        });
    }

    /**
     * Get User information by userId (user_name field)
     *
     * @param {String} userId value of the user_name field
     * @returns {Promise}
     */
    const getUserById = (userId, pageCallBack) => {
        return client.get({
            url: `api/${appPrefix}/cicd/user/${userId}`,
            retry: DEFAULT_RETRY,
            delay: DEFAULT_DELAY
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
                sysparm_fields: 'sys_id, application.name, application.scope, application.sys_id, application.version, name, description, state, remote_sys_id, sys_created_by, sys_created_on, sys_updated_by, sys_updated_on'
            },
            retry: DEFAULT_RETRY,
            delay: DEFAULT_DELAY
        }).then((result) => {
            if (!result.length)
                throw Error(`UpdateSet not found with ID ${updateSetSysId}`);

            var us = result[0];
            const updateSet = {
                sys_id: us.sys_id.value,
                appName: us['application.name'].display_value,
                scopeName: us['application.scope'].display_value,
                scopeId: us['application.sys_id'].value,
                appVersion: us['application.version'].value || '0',
            };

            ['name', 'description', 'state', 'remote_sys_id', 'sys_created_by', 'sys_created_on', 'sys_updated_by', 'sys_updated_on'].forEach((field) => {
                updateSet[field] = us[field].value;
            });
            return updateSet;

        });
    };


    /**
     * Get information about a Scope / App
     *
     * @param {*} scopeId the sys_id of the scope
     * @returns {Promise}
     */
    const getScopeDetails = (scopeId) => {
        return client.get({
            url: `api/${appPrefix}/cicd/scope/${scopeId}`,
            qs: {
                sysparm_fields: 'sys_id, name, scope, version'
            },
            retry: DEFAULT_RETRY,
            delay: DEFAULT_DELAY
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
                sysparm_fields: 'action, name, payload, update_set, sys_id, sys_created_by, sys_updated_by'
            },
            retry: DEFAULT_RETRY,
            delay: DEFAULT_DELAY
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
            url: `api/${appPrefix}/cicd/test_in_suites`,
            retry: DEFAULT_RETRY,
            delay: DEFAULT_DELAY
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
            url: `/api/${appPrefix}/cicd/atf/track/${id}`,
            retry: DEFAULT_RETRY,
            delay: DEFAULT_DELAY
        }, pageCallBack);
    };

    /**
     * 
     * 
     * @returns {Promise}
     */
    const getSuiteResults = (id, pageCallBack) => {
        return client.get({
            url: `/api/${appPrefix}/cicd/atf/suite//${id}`,
            retry: DEFAULT_RETRY,
            delay: DEFAULT_DELAY
        }, pageCallBack);
    };

    /**
     * 
     * 
     * @returns {Promise}
     */
    const getTestResults = (id, pageCallBack) => {
        return client.get({
            url: `/api/${appPrefix}/cicd/atf/test/${id}`,
            retry: DEFAULT_RETRY,
            delay: DEFAULT_DELAY
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
    const getFilesFromTable = ({ tableName, options }, pageCallBack) => {
        const settings = assign({
            qs: {
                sysparm_query: undefined,
                sysparm_display_value: undefined,
                active: undefined,
                sysparm_fields: undefined,
                sysparm_suppress_pagination_header: undefined
            },
            autoPagination: true
        }, options || {}, {
            url: `api/${appPrefix}/cicd/file/${tableName}`,
            retry: DEFAULT_RETRY,
            delay: DEFAULT_DELAY
        });

        // if the process must not follow the pages, no need to have the pagination_header
        if(settings.autoPagination == false && settings.qs.sysparm_suppress_pagination_header === undefined)
            settings.qs.sysparm_suppress_pagination_header = true;

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
        return client.patch({ url: `api/${appPrefix}/cicd/updateset_status/${updateSetSysId}` }, {
            state: state
        });
    };

    const canDeploy = (source, target) => {
        return Boolean(source && target && source != target);
    };

    const collDetectUpdateSet = ({ updateSetSysId, commitId, targetHostName, targetAuth, sourceAuth }) => {
        return Promise.try(() => {
            return deployUpdateSet({ updateSetSysId, commitId, targetHostName, targetAuth, sourceAuth, collisionDetect: true })
        });
    };


    /**
     * Deploy an UpdateSet to a Target Environment
     *
     * @param {*} updateSetSysId the sys_id of the update set
     * @param {*} targetHostName the FQDN of the target host
     * @param {clientId, clientSecret, accessToken, refreshToken, username, password} targetAuth (optional) the CD credentials of the target env
     * @param {clientId, clientSecret, accessToken, refreshToken, username, password} sourceAuth (optional) the CD credentials of the source env
     * @returns {Promise}
     */
    const deployUpdateSet = ({ updateSetSysId, commitId, targetHostName, targetAuth, sourceAuth, deploy, collisionDetect, conflictResolutions }) => {

        const WAIT_DELAY_MS = 1000; // delay in milliseconds for the update-set status to check.
        const MAX_WAIT_SEC = 5 * 60; // time in seconds for the update-set to be completed;
        const MAX_ITERATIONS = (MAX_WAIT_SEC * 1000 / WAIT_DELAY_MS);

        const start = Date.now();

        let body, iterations = 0;
        return Promise.try(() => {
            if (!canDeploy(hostName, targetHostName))
                throw `Target ${targetHostName} must be different from source ${hostName}.`


            const checkSourceVersion = checkVersion({ hostName, auth: { username, password } });
            const checkTargetVersion = checkVersion({ hostName: targetHostName, auth: targetAuth });
            return Promise.all([checkSourceVersion, checkTargetVersion]);

        }).then(() => {

            if(conflictResolutions){
                const conflicts = Object.keys(conflictResolutions).map((conflict)=>{
                    return `${conflictResolutions[conflict].status.toUpperCase()} '${conflict}'`; 
                }).join(', ');
                if(conflicts.trim())
                    console.log(`Auto resolve: ${conflicts}`);
            }
            if(process.env.CICD_CD_DEPLOY_ALWAYS_SKIP_CONFLICTS){
                console.log(`Auto skip: ${process.env.CICD_CD_DEPLOY_ALWAYS_SKIP_CONFLICTS}`);
            }
            if(process.env.CICD_CD_DEPLOY_ALWAYS_IGNORE_CONFLICTS){
                console.log(`Auto ignore: ${process.env.CICD_CD_DEPLOY_ALWAYS_IGNORE_CONFLICTS}`);
            }
            
            console.log(`Auto ignore data loss: ${Boolean(process.env.CICD_CD_DEPLOY_ALWAYS_IGNORE_DATA_LOSS === 'true')}`);

            return promiseFor((nextOptions) => Boolean(nextOptions),
                (options) => {
                    console.log('Request: ', options.url);                    
                    //console.dir(options, { colors: true, depth: null });

                    // create a new copy of the defaults client
                    return new SnRestClient({
                        proxy: proxy,
                        auth: options.auth,
                        debug: debug,
                        silent: silent
                    }).run(options).then((response) => {

                        /*
                        console.log("response")
                        console.dir(response.body, { colors: true, depth: null });
                        */
                        let location;
                        if (response.statusCode === 200) {
                            options = null;
                            body = response.body;
                            return;
                        }

                        if (response.statusCode !== 202)
                            throw Error("Incorrect response");

                        const statusCode = (response.body && response.body.result) ? response.body.result._status : -1

                        /*
                            202: job created, come back to url 
                            303: job completed, follow redirect to next step
                            304: job running, wait and come back
                        */
                        if (statusCode === 202 || statusCode === 303) {

                            location = response.headers.location;
                            if (!location)
                                throw Error('Location header not found');

                            // reset the counter
                            iterations = 0;

                            //console.log(`RESPONSE ${statusCode} BODY`, response.body.result);
                            options.body = response.body.result;
                            delete options.body._status;
                            options.method = 'POST';
                            options.url = location;
                            options.auth = targetAuth || options.auth;
                            return options;

                        } else if (statusCode === 304) {
                            // count iterations
                            iterations++;

                            if (iterations > MAX_ITERATIONS) {
                                throw Error(`Commit did not complete in SNOW after ${MAX_WAIT_SEC} seconds.`);
                            }

                            location = response.headers.location;
                            if (!location)
                                throw Error('Location header not found');

                            //console.log("RESPONSE 304 BODY", response.body.result);
                            options.body = response.body.result;
                            delete options.body._status;
                            options.method = 'POST';
                            options.url = location;
                            options.auth = targetAuth || options.auth;

                            //console.log(`Redirect to: ${options.url}`);
                            console.log(`Job in progress. Wait for ${WAIT_DELAY_MS} ms ...`);
                            return Promise.delay(WAIT_DELAY_MS).then(() => {
                                return options;
                            });
                        } else {
                            throw Error(`Status code ${response.statusCode}`);
                        }
                    });
                },
                {
                    auth: {
                        clientId: clientId,
                        clientSecret: clientSecret,
                        accessToken: accessToken,
                        refreshToken: refreshToken,

                        username: (sourceAuth) ? sourceAuth.username : username,
                        password: (sourceAuth) ? sourceAuth.password : password
                    },
                    rawResponse: true,
                    followRedirect: false,
                    method: 'POST',
                    url: `${hostName}/api/${appPrefix}/cicd/deploy`,
                    body: {
                        updateSetSysId: updateSetSysId,
                        commitId: commitId,
                        deploy: (collisionDetect ? false : Boolean(deploy)),
                        collisionDetect: Boolean(collisionDetect),
                        targetEnvironment: {
                            host: targetHostName,
                            username: (targetAuth) ? targetAuth.username : null,
                            password: (targetAuth) ? targetAuth.password : null
                        },
                        sourceEnvironment: {
                            username: (sourceAuth) ? sourceAuth.username : null,
                            password: (sourceAuth) ? sourceAuth.password : null
                        },
                        conflicts: {
                            resolutions: conflictResolutions || {},
                            defaults: {
                                skip: process.env.CICD_CD_DEPLOY_ALWAYS_SKIP_CONFLICTS,
                                ignore: process.env.CICD_CD_DEPLOY_ALWAYS_IGNORE_CONFLICTS,
                                ignoreDataLoss: Boolean(process.env.CICD_CD_DEPLOY_ALWAYS_IGNORE_DATA_LOSS === 'true')
                            }

                        }
                    }
                }
            );
        }).then(function () {
            return {
                result: body.result,
                seconds: (Math.round((Date.now() - start) / 10) / 100)
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
            rawResponse: true,
            retry: DEFAULT_RETRY,
            delay: DEFAULT_DELAY
        }).then((response) => ({
            name: `sys_update_set_${updateSetSysId}.xml`,
            content: response.body
        }));
    };


    const exportApplication = (appId) => {

        var req = require('request');
        var jar = req.jar();

        // run the first request 2 times to have all required cookies
        return client.get({
            jar,
            url: `api/${appPrefix}/cicd/export_application/${appId}`,
            retry: DEFAULT_RETRY,
            delay: DEFAULT_DELAY
        }).then((response) => {
            //console.log('response', response);
            if (!response || !response.length)
                throw "application not found";

            return response[0].updateSetSysId;
        }).then((updateSetSysId) => {
            return setUpdateSetStatus(updateSetSysId, 'build').then(() => updateSetSysId);

        });
    };


    return {

        get: (options) => {
            return client.get(options);
        },

        getUserById: getUserById,

        getUpdateSetDetails: getUpdateSetDetails,

        getScopeDetails: getScopeDetails,

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

        collDetectUpdateSet: collDetectUpdateSet,

        exportUpdateSet: exportUpdateSet,

        client: client,

        canDeploy: canDeploy,

        exportApplication
    };



};
