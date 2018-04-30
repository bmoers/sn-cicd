/* exported CiCdDeploy */
/* global gs, sn_ws, sn_ws_err, Class, GlideEncrypter, GlideSecureRandomUtil, GlideUpdateSetWorker, GlideDateTime, GlideRecord, GlideProperties, JSON */


/**
 * CD API to request target instance to pull update set
 * 
 * @class 
 * @author Boris Moers [SRZXBX]
 * @requires sn_ws_err.module:sys_script_include.BadRequestError
 * @requires sn_ws.module:sys_script_include.RESTMessageV2
 * @memberof global.module:sys_script_include
 */
var CiCdDeploy = Class.create();

CiCdDeploy.prototype = /** @lends global.module:sys_script_include.CiCdDeploy.prototype */ {

    /*
        Installation:
            Create a scripted REST API implementing following (the endpoints in this script need to be changed too):

            Name:
                [CD] Deploy Update Set to Target Env.
            Endpoint:
                /deploy
            Method:
                POST
            Script:
                (function process(request, response) {
                    return new VirtualAppsDeploy(request, response).deployUpdateSet();
                }) (request, response);

            Name:
                [CD] Pull Update Set from Source Env.
            Endpoint:
                /pull
            Method:
                POST
            Script:
                (function process(request, response) {
                    return new VirtualAppsDeploy(request, response).pullUpdateSet();
                }) (request, response);

            Name:
                [CD] Get Commit Update Set Information
            Endpoint:
                /commit/{sysId}
            Method:
                GET
            Script:
                (function process(request, response) {
                    return new VirtualAppsDeploy(request, response).commitUpdateSet();
                }) (request, response);

    */

    /**
     * return the bearer token to access the remote instance
     * @returns {undefined}
     */
    getBearer: function(){
        /*
            TODO
                return the bearer token to access the target env.
        */
    },

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

        self.body = null;
        var requestBody = self.request.body;

        try {
            // in case of GET or DELETE, this is throwing an error
            if (requestBody && requestBody.hasNext()) {
                var body = requestBody.nextEntry();
                if (body) {
                    self.body = body;
                } else {
                    gs.error('initialize: no body found');
                }
            } else {
                gs.error('initialize: no request payload found');
            }
        } catch (ignore) {
            // gs.error(ignore);
        }
    },

    /**
     * Remove Update Set Source on target
     * 
     * @param {any} sourceSysId
     * @returns {undefined}
     */
    teardownTarget: function (sourceSysId) {
        var source = new GlideRecord('sys_update_set_source');
        if (!gs.nil(sourceSysId) && source.get(sourceSysId)) {
            source.deleteRecord();
        }
    },


    /**
     * Target API. This API is called from the source env.<br>
	 * If required, it creates and configures a local update-set-source, pulls the Update-Set from the source env and returns preview status.<br>
	 * 
     * This is mapped to /api/swre/v1/va/pull
     * @returns {undefined}
     */
    pullUpdateSet: function () {
        var self = this,
            sourceSysId;

        if (!self.body) {
            gs.error('no request payload found');
            self.response.setError(new sn_ws_err.BadRequestError('no request payload found'));
            return;
        }

        if (gs.nil(self.body.updateSetSysId) || gs.nil(self.body.sourceEnvironment) || gs.nil(self.body.credentials) ||
            gs.nil(self.body.credentials.user) ||
            gs.nil(self.body.credentials.password)) {
            self.response.setError(new sn_ws_err.BadRequestError('updateSetSysId, sourceEnvironment and credentials are mandatory'));
            return;
        }

        try {
            var updateSetSysId = self.body.updateSetSysId;
            var sourceEnvironment = self.body.sourceEnvironment;
            var credentials = self.body.credentials;

            /*
                create a dynamic source definition
            */
            var source = new GlideRecord('sys_update_set_source'),
                name = new GlideChecksum(sourceEnvironment).getMD5().substr(0, 40),
                desc = 'CICD deployment source for '.concat(sourceEnvironment).concat('. DO NOT DELETE OR CHANGE!');

            if (source.get('url', sourceEnvironment)) {
                if (credentials.password) {
                    source.setValue('username', credentials.user);
                    source.setValue('password', new GlideEncrypter().decrypt(credentials.password));
                    source.setValue('name', name);
                    source.setValue('short_description', desc);
                    source.setValue('type', 'dev');
                    source.setValue('active', true);
                    source.update();
                }
                sourceSysId = source.getValue('sys_id');
            } else {
                source.initialize();

                source.setValue('url', sourceEnvironment);
                source.setValue('username', credentials.user);
                source.setValue('password', new GlideEncrypter().decrypt(credentials.password));
                source.setValue('name', name);
                source.setValue('short_description', desc);
                source.setValue('type', 'dev');
                source.setValue('active', true);
                sourceSysId = source.insert();
            }


            gs.info("sys_update_set_source {0}", sourceSysId);

            if (gs.nil(sourceSysId)) {
                self.response.setError(new sn_ws_err.BadRequestError('sys_update_set_source creation failed.'));
                return;
            }

            /*
                if this update set was already loaded, delete it.
            */
            var rus = new GlideRecord('sys_remote_update_set');
            if (rus.get('remote_sys_id', updateSetSysId)) {
                gs.info("deleting already loaded update set {0}", updateSetSysId);
                
                var lus = new GlideRecord('sys_update_set');
                lus.addQuery('sys_id', rus.getValue('update_set'));
                /*
                    only delete if it was not changed (opened) on the target system since last deployment
                */
                lus.addQuery('sys_mod_count', 2); 
                lus._query();
                if (lus._next()) {
                    lus.deleteRecord();    
                }
                
                // delete the remote update set
                rus.deleteRecord();
            }
            
            var worker = new GlideUpdateSetWorker();
            worker.setUpdateSourceSysId(sourceSysId); // the sys_update_set_source sys_id
            worker.setLimitSet(updateSetSysId); // the update-set sys_id 
            //worker.setBackground(true);
            worker.setBackground(false);
            worker.start();
            // the progress_id must be used to check the worker in case of background(true)
            var progressId = worker.getProgressID();


            gs.info("GlideUpdateSetWorker completed progress_id: {0}", progressId);

            // now check if the update-set preview worked


            rus = new GlideRecord('sys_remote_update_set');
            if (!rus.get('remote_sys_id', updateSetSysId)) {
                self.response.setError(new sn_ws_err.BadRequestError('update set was not loaded: ' + updateSetSysId));
                return;
            }

            //gs.info("remote update set is: {0}", rus);
            var remoteUpdateSetSysId = rus.getValue('sys_id');
            var state = rus.getValue('state');

            return {
                remoteUpdateSetSysId: remoteUpdateSetSysId,
                state: state,
                readyToCommit: (state == 'previewed'),
                targetEnvironment: gs.getProperty('glide.servlet.uri')
            };

        } catch (e) {
            gs.info("pullUpdateSet {0}", e);

        } finally {
            // remove the source
            //self.teardownTarget(sourceSysId);
        }

    },

    /**
     * Target Commit API. This API does not Commit the US but returns all required information to do the commit request.
	 *    mapped to /api/swre/v1/va/commit
     * 
     * @returns {any} 
     */
    commitUpdateSet: function () {
        var self = this,
            sysId = self.request.pathParams['sysId'];

        return {
            method: 'POST',
            endpoint: 'xmlhttp.do',
            headers: {
                'X-UserToken': gs.getSessionToken()
            },
            validate: {
                'sysparm_processor': 'com.glide.update.UpdateSetCommitAjaxProcessor',
                'sysparm_scope': 'global',
                'sysparm_want_session_messages': 'true',
                'sysparm_type': 'validateCommitRemoteUpdateSet',
                'sysparm_remote_updateset_sys_id': sysId
            },
            commit: {
                'sysparm_processor': 'com.glide.update.UpdateSetCommitAjaxProcessor',
                'sysparm_scope': 'global',
                'sysparm_want_session_messages': 'true',
                'sysparm_type': 'commitRemoteUpdateSet',
                'sysparm_remote_updateset_sys_id': sysId
            }
        };
    },
    

    /**
     * Remove user and role on source environment
     * 
     * @param {any} roleSysId
     * @param {any} userSysId
     * @returns {undefined}
     */
    teardownSource: function (roleSysId, userSysId) {

        var role = new GlideRecord('sys_user_has_role');
        if (!gs.nil(roleSysId) && role.get(roleSysId)) {
            role.deleteRecord();
        }
        var user = new GlideRecord('sys_user');
        if (!gs.nil(userSysId) && user.get(userSysId)) {
            user.deleteRecord();
        }
    },


    /**
     * Source API. <br>This is the entry point to trigger a deployment on a target env.
	 * takes updateSetSysId and targetEnvironment from payload body. <p>
	 *  It: 
	 *  <ul>
	 *  <li>creates a local admin user with a random password</li>
	 *  <li>sends a pull request for the update-set to the target containing
	 *  <ul><li>User Credentials (encrypted)</li><li>Update Set ID</li><li>Source environment</li>
	 *  </li>
	 *  <li>waits for the target instance to pull and check the update-set</li>
	 *  <li>returns the update-set status on the target env</li>
	 *  </ul>
	 * </p>
	 *
	 * This is mapped to /api/swre/v1/va/deploy
     * 
     * @returns {undefined}
     */
    deployUpdateSet: function () {
        var self = this,
            userSysId,
            roleSysId;

        if (!self.body) {
            gs.error('no request payload found');
            self.response.setError(new sn_ws_err.BadRequestError('no request payload found'));
            return;
        }
        if (gs.nil(self.body.updateSetSysId) || gs.nil(self.body.targetEnvironment)) {
            self.response.setError(new sn_ws_err.BadRequestError('updateSetSysId and targetEnvironment are mandatory'));
            return;
        }


        var updateSetSysId = self.body.updateSetSysId; // request.updateSetId
        var sourceEnvironment = gs.getProperty('glide.servlet.uri'); // the current instance
        var targetEnvironment = self.body.targetEnvironment; // request.targetEnvironment

        if (targetEnvironment == sourceEnvironment) {
            self.response.setError(new sn_ws_err.BadRequestError('source and target can not be same'));
            return;
        }

        var us = new GlideRecord('sys_update_set');
        if (us.get(updateSetSysId)) {
            if (us.getValue('state') != 'complete') {
                self.response.setError(new sn_ws_err.BadRequestError('UpdateSet is Not in complete state'));
                return;
            }
        }

        try {

            // create user on source instance
            var user = new GlideRecord('sys_user'),
                userName = '_CICD_DEPLOYMENT_'.concat(new GlideChecksum(targetEnvironment).getMD5()).substr(0, 40),
                userPassword = GlideSecureRandomUtil.getSecureRandomString(100);

            if (user.get('user_name', userName)) {
                user.setDisplayValue('user_password', userPassword);
                userSysId = user.getValue('sys_id');
                user.update();

            } else {
                user.initialize();
                user.setValue('user_name', userName);
                user.setDisplayValue('user_password', userPassword);
                userSysId = user.insert();

                // assign admin role
                var roleAssignment = new GlideRecord('sys_user_has_role');
                roleAssignment.initialize();
                roleAssignment.setValue('user', userSysId);
                roleAssignment.setValue('role', '2831a114c611228501d4ea6c309d626d'); // admin sys_id
                roleAssignment.setValue('state', 'active');
                roleSysId = roleAssignment.insert();
            }

            // call target instance to load the update set
            var endpoint = targetEnvironment.concat('/api/swre/v1/va/pull'),
                requestBody = {
                    updateSetSysId: updateSetSysId,
                    sourceEnvironment: sourceEnvironment,
                    credentials: {
                        user: userName,
                        password: (userPassword) ? new GlideEncrypter().encrypt(userPassword) : null
                    }
                };

            var successful = false,
                responseBody = null;
            var request = new sn_ws.RESTMessageV2();
            request.setEndpoint(endpoint);
            request.setRequestHeader('Authorization', 'Bearer '.concat(self.getBearer()));
            request.setRequestHeader("Accept", "application/json");
            request.setRequestHeader("Content-Type", "application/json");
            request.setHttpMethod('POST');

            request.setRequestBody(JSON.stringify(requestBody));

            //gs.info("POST body: {0}", requestBody);

            try {
                var response = request.execute(); // Async somehow does not perform
                // response.waitForResponse(self.WAIT_FOR_RESPONSE);

                if (!response.haveError()) {

                    var responseText = response.getBody();
                    responseBody = JSON.parse(responseText);
                    if (responseBody) {
                        // TODO
                        // check response body for successful build start
                        //gs.info("successful - result is: {0}", responseBody);
                        successful = true;
                    }
                } else {
                    successful = false;
                    var statusCode = response.getStatusCode();
                    gs.error("{0} request ended in error {1}", endpoint, statusCode);
                }
            } catch (e) {
                gs.error("Pull request error: {0}", e);
            }

            if (successful) {
                return responseBody.result;
            } else {
                self.response.setError(new sn_ws_err.BadRequestError('Deployment failed'));
                
            }

        } finally {
            // remove the local admin and role
            //self.teardownSource(roleSysId, userSysId);
        }

    },

    type: 'VirtualAppsDeploy'
};