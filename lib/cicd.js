require('dotenv').config();

process.env['BLUEBIRD_DEBUG'] = true;
process.env['BLUEBIRD_LONG_STACK_TRACES'] = true;

require('console-stamp')(console, {
    pattern: 'HH:MM:ss.l',
    metadata: `[${process.pid}]`.padEnd(8),
    colors: {
        stamp: ['blue'],
        label: ['white'],
        metadata: ['green']
    }
});

var Promise = require('bluebird');
var etparse = require('elementtree').parse,
    assign = require('object-assign-deep'),
    path = require("path"),
    fs = Promise.promisifyAll(require("fs-extra"));
const camelCase = require('camelcase');

var SnProject = require("sn-project");
const EventBusJob = require('./eb/job');


var promiseFor = Promise.method((condition, action, value) => {
    if (!condition(value))
        return value;
    return action(value).then(promiseFor.bind(null, condition, action));
});

var CICDInt = require('./cicdInt');

var CICD = (function () {

    /**
     * Constructor 
     *
     * @param {*} options
     */
    var CICD = function (options) {

        const self = this;

        self.SERVER = 'server';
        self.WORKER = 'worker';

        self.settings = {};
        self.userCache = {};
        self.dataStore = {
            application: null,
            us: null,
            run: null,
            step: null
        };
        self.db = null;

        // create list of directories to check for modules
        let parent = module.parent;
        const moduleDirs = [path.dirname(module.filename)];
        while (parent) {
            moduleDirs.push(path.dirname(parent.filename));
            parent = parent.parent || false;
        }


        // dynamically load all modules 
        self.modules = moduleDirs.reduce((modules, dir) => {
            const fullDir = path.join(dir, 'modules');
            if (fs.existsSync(fullDir)) {
                fs.readdirSync(fullDir).forEach((file) => {
                    const fArr = file.split(".");
                    var isLibrary = (fArr.length > 0 && fArr[1] === 'js'),
                        libName = camelCase(fArr[0]);
                    if (isLibrary) {
                        console.log(`${((modules[libName]) ? '!!!! Overloading' : 'Loading')} Module: '${libName}' from Path: ${path.join(fullDir, file)}`);
                        modules[libName] = require(path.join(fullDir, file));
                    }
                });
            }
            return modules;
        }, {});


        if (typeof options == 'string') {
            options = path.resolve(options);
            if (fs.existsSync(options)) {
                console.log("loading options from file", options);
                options = JSON.parse(fs.readFileSync(options, 'utf8'));
            } else {
                console.warn("config file not found under:", options);
            }
        }
        const tempDir = require('os').tmpdir();
        self.settings = assign({
            dataStore: {
                type: 'nedb',
                path: path.join(process.cwd(), 'db')
            },
            gitRepoRootDir: path.resolve(tempDir, 'git-root'),
            tempBuildRootDir: path.resolve(tempDir, 'temp-build'),
            documentsRootDir: path.resolve(tempDir, 'doc-root')
        }, options || {}, {
            server: {
                port: (process.env.CICD_WEB_HTTPS_PORT) ? process.env.CICD_WEB_HTTPS_PORT : process.env.CICD_WEB_HTTP_PORT,
                hostName: `${(process.env.CICD_WEB_HTTPS_PORT) ? 'https' : 'http'}://${process.env.CICD_WEB_HOST_NAME}`
            },
            proxy: {
                proxy: process.env.PROXY_HTTPS_PROXY,
                strictSSL: process.env.PROXY_STRICT_SSL
            }
        });
        
        return {
            start: () => {
                return self.start();
            },
            worker: () => {
                return self.worker();
            },
        };
    };

    CICD.prototype = new CICDInt();

    CICD.prototype.init = function (mode) {

        const self = this;

        if (self._init !== undefined)
            return;

        self._init = true;

        console.log('INIT\t', 'mode', mode);

        if (self.SERVER !== mode) {
            /*
                worker mode setup
            */
            self.db = require('./prototype/load-dao').call(self);
            console.log('INIT\t', 'db-type', self.db.type);
            return;
        }

        if ('nedb' == self.settings.dataStore.type) {
            var Datastore = require('nedb');
            Object.keys(self.dataStore).forEach((collection) => {
                var coll = new Datastore({
                    filename: path.join(self.settings.dataStore.path, `${collection}.db`),
                    autoload: true
                });
                Promise.promisifyAll(coll);
                self.dataStore[collection] = coll;
            });
        }

        /*
            server mode setup
        */
        self.db = require('./prototype/load-dao').call(self);
        console.log('INIT\t', 'db-type', self.db.type);

        /*
            reset all update-set running flag
        */
        self.db.us.find({}).then((result) => {
            //console.log('self.db.us.find({})', result);
            result.forEach((us) => {
                if (us.running) {
                    us.running = false;
                    self.db.us.update(us);
                }
            });
        });

    };


    //#region private functions
    CICD.prototype.getSlack = function () {
        const self = this;
        //console.log("settings.slack %j", settings.slack);
        return new self.Slack({
            active: process.env.CICD_SLACK_ENABLED || false,
            webhookUri: process.env.CICD_SLACK_WEBHOOK,
            channel: process.env.CICD_SLACK_CHANNEL_OVERRIDE
        });
    };

    CICD.prototype.getGit = function (ctx) {
        const self = this;
        var config = ctx.config;

        config.application.git.dir = path.join(config.application.id, (ctx.config.build.sequence).toString());
        
        return new self.Git({
            dir: ctx.config.application.dir.code,
            gitignore: ['/config/', '/test/', '/*.*', '/docs*/', '!.gitignore'],
            remoteUrl: config.application.git.remoteUrl,
            quiet: true,
            user :{
                name: process.env.CICD_GIT_USER_NAME || null,
                email: process.env.CICD_GIT_USER_EMAIL || null
            }
        });
    };

    CICD.prototype.getProject = function (config) {
        return new SnProject({
            dir: config.application.dir.code,
            appName: config.application.name,
            dbName: config.branch.name,
            organization: config.application.organization,
            includeUnknownEntities: config.application.includeUnknownEntities
        });
    };

    CICD.prototype.getClient = function (config) {
        const self = this;
        return new self.SnClient({
            host_name: config.host.name,
            proxy: config.settings.proxy,
            client_id: config.host.credentials.oauth.clientId,
            client_secret: config.host.credentials.oauth.clientSecret,
            access_token: config.host.credentials.oauth.accessToken,
            refresh_token: config.host.credentials.oauth.refreshToken,
            debug: false,
            silent: true,
            jar: config.host.jar || false
        });
    };


    CICD.prototype.getValue = function (element) {
        if (element === undefined)
            return undefined;
        return (element.value !== undefined) ? element.value : element;
    };

    CICD.prototype.getDisplayValue = function (element) {
        const self = this;
        if (element === undefined)
            return undefined;
        return (element.display_value !== undefined) ? element.display_value : self.getValue(element);
    };

    CICD.prototype.finalizeRun = function (config, entry, error) {
        const self = this;
        return Promise.try(() => {
            if (error) {
                return self.addStep(config, 'finalizeRun-error', error);
            }
        }).then(() => {
            
            if (config.build.run.us) {
                return self.db.us.get(config.build.run.us).then((us) => {
                    us.running = false;
                    us.state = (error) ? 'failed' : 'successful';
                    if (!error && config.build.run.instance) {
                        us.lastSuccessfulRun = config.build.run.instance;
                    }
                    return this.db.us.update(us).then(() => {
                        return this.db.run.update(config.build.run.instance);
                    });
                });
                
            }
        }).catch((e) => {
            console.error('CICD.prototype.finalizeRun', e);
        });

    };

    

    CICD.prototype.addStep = function (config, state, error) {
        const self = this;
        return Promise.try(() => {
            var run = config.build.run.instance;
            if (!run) {
                console.warn(`addStep, no run instance found. State: ${state}`);
                return;
            }

            var step = {
                run: run._id,
                state: state,
                ts: new Date().getTime()
            };
            if (error)
                step.error = error.message || (error).toString();

            console.log(step.state, step.error || '');

            return self.db.step.insert(step);
        }).catch((e) => {
            console.error('CICD.prototype.addStep', e);
        });
    };

    CICD.prototype.loadUpdateSet = function (ctx) {
        const self = this;

        var client = self.getClient(ctx.config),
            config = ctx.config;

        return client.getUpdateSetDetails(config.updateSet).then((updateSetObj) => {
            config.updateSet = updateSetObj;
        }).then(() => {
            // set the branch name
            config.branchName = `${config.updateSet.name}-@${config.updateSet.sys_id}`;
        });
    };

    CICD.prototype.getUser = function (client, userId) {
        const self = this;
        return Promise.try(() => {
            var user = self.userCache[userId];
            if (user)
                return user;

            return client.getUserById(userId).then((result) => {
                if (result.length) {
                    var tmp = result[0];
                    user = {
                        sys_id: tmp.sys_id,
                        name: tmp.name || 'unknown',
                        email: tmp.email || (tmp.name || 'unknown').concat('@')
                    };
                } else {
                    user = {
                        sys_id: null,
                        name: userId,
                        email: userId.concat('@')
                    };
                }
                self.userCache[userId] = user;
                return user;
            });
        });
    };


    /**
     * group the filesOnDisk array by updatedBy (user)
     * 
     * @param {Array} filesOnDisk 
     * @returns {Promise<Object>}
     */
    CICD.prototype.getFilesByUpdatedBy = function (filesOnDisk) {
        const self = this;
        return Promise.reduce(filesOnDisk, (fileByUpdatedBy, file) => {
            var updatedBy = file.updatedBy;

            if (fileByUpdatedBy[updatedBy] === undefined)
                fileByUpdatedBy[updatedBy] = [];

            fileByUpdatedBy[updatedBy].push(file.path);
            return fileByUpdatedBy;
        }, {});
    };

    /**
     * group and process all files by className
     * 
     * @param {Array} applicationFiles {sys_id, u_file_class, u_file}
     * @returns {Promise}
     */
    CICD.prototype.processFilesByClass = function (ctx, applicationFiles) {
        const self = this;
        var project = ctx.project,
            client = ctx.remote,
            config = ctx.config;

        ctx.project = self.getProject(config);
        applicationFiles = applicationFiles || [];
        /*
            sort applicationFiles by className
            this allows us to reduce the calls to one per class/table name
            { classNameX : [sysId,sysId], classNameY : [sysId,sysId] }
        */
        console.log("Process files by class");
        return Promise.reduce(applicationFiles, (applicationFilesByClass, file) => {
            var className = file.className || file.sys_class_name;
            if (applicationFilesByClass[className] === undefined)
                applicationFilesByClass[className] = [];

            applicationFilesByClass[className].push(file);
            return applicationFilesByClass;

        }, {}).then((applicationFilesByClass) => {

            var filesOnDisk = [];
            // callback per chunk
            return Promise.each(Object.keys(applicationFilesByClass), (className) => {
                console.log("\t", className);
                return self.processFiles(ctx, className, applicationFilesByClass[className]).then((filesUpdated) => {
                    filesOnDisk = filesOnDisk.concat(filesUpdated);
                });
            }).then(() => {
                return filesOnDisk;
            });
        });
    };

    /**
     * 
     * 
     * @param {String} className 
     * @param {Array} sysIds 
     * @returns {Promise}
     */
    CICD.prototype.processFiles = function (ctx, className, applicationFiles) {
        const self = this;
        var project = ctx.project,
            remote = ctx.remote,
            config = ctx.config;

        return Promise.try(() => {

            // get the request params for this entity className
            return project.getEntityRequestParam(className);

        }).then((entityRequestParam) => {

            var fileSysIds = applicationFiles.map((file) => {
                return file.sysId || file.sys_id;
            });
            var hasQuery = (entityRequestParam.queryFieldNames.length),
                query = `sys_idIN${fileSysIds.join(',')}`;

            if (hasQuery) {
                var entity = project.getEntity(className);

                query = entity.query.split('^NQ').map((segment) => {
                    return `sys_idIN${fileSysIds.join(',')}^${segment}`;
                }).join('^NQ');
            }

            /* configure the request parameter
                !! assuming the number of sys_id per class is not more then e.g. 50
            */
            return {
                tableName: entityRequestParam.className,
                options: {
                    qs: {
                        sysparm_query: query,
                        sysparm_display_value: 'all', //entityRequestParam.displayValue || false,
                        active: true,
                        sysparm_fields: entityRequestParam.fieldNames.map(function (field) {
                            return field.name;
                        }).join(',') || null
                    }
                }
            };
        }).then((requestParam) => {
            var filesOnDisk = [];

            return remote.getFilesFromTable(requestParam, (files) => {

                // parse and save file to disk
                return Promise.each(files, (file) => {

                    // in case the file has no sys_class_name parameter (like 'sys_update_set'), add the tableName as it
                    //file.sys_class_name = className;
                    var appName = 'Global',
                        scopeName = 'global',
                        updatedBy = 'system';

                    var appNameObj = file['sys_scope.name'] || appName;
                    appName = appNameObj.display_value || appNameObj.value || appNameObj;

                    var scopeNameObj = file['sys_scope.scope'] || scopeName;
                    scopeName = scopeNameObj.display_value || scopeNameObj.value || scopeNameObj;

                    var updatedByField = file.sys_updated_by || file.sys_created_by || updatedBy;
                    updatedBy = updatedByField.display_value || updatedByField.value || updatedByField;

                    /*
                        TODO:
                        - check if the file in the fileList has an update_on value older than the real one.
                          this indicates that the record was modified in the default update set.
 
                    */
                    // simulate a change on master 
                    //file.sys_created_by = 'WHAHAHAHHHHAHHHHHHHAAA!';

                    file.____ = {
                        hostName: remote.getHostName(), // getHostName()
                        className: className,
                        appName: appName,
                        scopeName: scopeName,
                        updatedBy: updatedBy,
                        src: undefined
                    };

                    //if ('sys_ui_policy' == file.sys_class_name)
                    return project.save(file).then((filesUpdated) => {
                        filesOnDisk = filesOnDisk.concat(filesUpdated);
                    });

                });

            }).then(() => {
                return filesOnDisk;
            });
        });

    };

    //#endregion

    CICD.prototype.build.setProgress = function ({config}, state) {
        const self = this;
        const client = self.getClient(config);
        const updateSetId = config.updateSet.sys_id || config.updateSet;

        console.log('setProgress', state);

        return Promise.try(() => {

           if (!client) {
                console.error("context not correctly created");
                return;
            }

            return client.setUpdateSetStatus(updateSetId, state);
        });
    };


    CICD.prototype.run = function (options, _ctx) {
        const self = this;
        let ctx = _ctx || {},
            error;

        const step = (message, error) => {
            return self.addStep(ctx.config, `${path.basename(__filename).split('.')[0]} : ${message}`, error);
        };

        return Promise.try(() => {
            return step(`CICD Run. ${options.application} ${options.updateSet}`);
            
        }).then(() => {
            return new EventBusJob({ name: 'projectSetup' }, {
                ctx: ctx,
                options: options
            }).then(({result, host}) => {
                ctx = result;
                return host;
            }).then((host) => {
                ctx.config.build.run.us.buildOnHost = host;
                return self.db.us.update(ctx.config.build.run.us).then(() => host);
            });
        }).then((host) => {
            return new EventBusJob({ name: 'exportFilesFromMaster', host: host }, ctx);

        }).then(({host}) => {
            return new EventBusJob({ name: 'exportUpdateSet', host: host }, ctx);

        }).then(({host}) => {
            if (process.env.CICD_EMBEDDED_BUILD === 'true') {
               return new EventBusJob({name: 'buildProject', host: host}, ctx); 
            } 
            return step(`Embedded Build is disabled. Waiting for external Build Tool to run.`);

        }).catch((e) => {
            error = e;
            return Promise.try(() => {
                return self.build.setProgress(ctx, this.build.FAILED);
            }).then(() => {
                return step(`failed`, e);
            }).then(() => {
                console.error(e);
                //throw e;
            });

        }).finally(() => {
            return self.finalizeRun(ctx.config, 'run()', error); //.call(this,
        });

    };

    /**
     * Run ATF tests, called from server / build / ROUTE_TEST_EXECUTE
     * 
     * @param {Object} param 
     * @param {Object} param.commitId the commit id to complete
     * @param {Object} param.build the build results
     * @returns {Promise<UpdateSet>}  the related update set
     */
    CICD.prototype.testProject = function ({commitId, build}) {
        const self = this;
        if (!commitId || !build)
            throw new Error(`'commitId' and 'build' are mandatory`);
        
        return self.db.us.find({
            commitId: commitId
        }).then((result) => {
            if (result && result.length)
                return result[0];
            throw new Error('No Build found for this commitId', commitId);

        }).then((us) => {
            us.testJob = 'requested';
            return self.db.us.update(us).then(() => us);

        }).then((us) => {

            return new EventBusJob({
                name: 'testProject',
                host: us.buildOnHost,
                async :true
            }, {
                config: assign({}, us.config, { settings: self.settings }),
                id: us._id
            }).then(() => us);

        });
    };

    /**
     * Build has completed, called from server / build / ROUTE_BUILD_COMPLETE
     * This might trigger internally the deployment of the updateSEt
     * 
     * @param {Object} param 
     * @param {Object} param.commitId the commit id to complete
     * @param {Object} param.build the build results
     */
    CICD.prototype.buildComplete = function ({commitId, build}) {
        const self = this;
        if (!commitId || !build)
            throw new Error(`'commitId' and 'build' are mandatory`);
        
        return self.db.us.find({
            commitId: commitId
        }).then((result) => {
            if (result && result.length)
                return result[0];
            throw new Error('No Build found for this commitId', commitId);
        }).then((us) => {

            return new EventBusJob({
                    name: 'buildComplete',
                    host: us.buildOnHost,
                    async: true
                },
                {
                    config: assign({}, us.config, {settings: self.settings}),
                    id: us._id,
                    build: build
                }
            );
        });
    };


    
    CICD.prototype.deployUpdateSet = function (config) {
        const self = this;

        var slack = self.getSlack();

        const step = (message, error) => {
            return self.addStep(config, `${path.basename(__filename).split('.')[0]} : ${message}`, error);
        };

        return Promise.try(() => {
            return step(`complete update-set ${config.updateSet.name}`);
        }).then(() => {
            return self.build.setProgress({config: config}, this.build.COMPLETE);

        }).then(() => {
            if (!(config.deploy && config.deploy.host && config.deploy.host.name)) {
                return step(`Deploy is disabled for this update-set`).then(() => {
                    return slack.message(`Update-Set <${config.host.name}/sys_update_set.do?sys_id=${config.updateSet.sys_id}|${config.updateSet.name}> needs to be deployed manually!`);
                });
            }

            return step(`deploying updateSet '${config.updateSet.sys_id}'  to '${config.deploy.host.name}'`).then(() => {
                return slack.message(`Deploying Update-Set <${config.host.name}/sys_update_set.do?sys_id=${config.updateSet.sys_id}|${config.updateSet.name}> from ${config.host.name} to ${config.deploy.host.name}`);
        
            }).then(() => { // deploy the update set
                return self.getClient(config).deployUpdateSet(config.updateSet.sys_id, config.deploy.host.name).catch((e) => {
                    if (409 == e.statusCode) { // validation issue
                        var result = e.error.result || {};
                        var error = result.error || {};
                        throw error;
                    } else {
                        throw e;
                    }
                }).then(({ result, seconds }) => {
                    return step(`UpdateSet successfully deployed in ${seconds} sec. Result: ${result}`).then(() => {
                        return slack.build.complete(`Update-Set <${config.host.name}/sys_update_set.do?sys_id=${config.updateSet.sys_id}|${config.updateSet.name}> committed on <${config.deploy.host.name}/sys_update_set.do?sys_id=${result.targetUpdateSetSysId}|${config.deploy.host.name}> within ${seconds} sec`);
                    });

                }).catch((e) => {
                    if (!e.updateSet)
                        throw e;

                    //console.error(e);

                    return Promise.try(() => {
                        // TODO: I think this is a bad idea to set the update-set to something else than complete or failed...
                        //return this.build.setProgress({ config: config }, this.build.DEPLOYMENT_MANUAL_INTERACTION);

                    }).then(() => {
                        return step(`Commit needs manual interaction!`, e);

                    }).then(() => {
                        var message = `${e.name}!\n${e.message}. <${e.updateSet}>`;
                        return slack.build.failed(message);
                    });
                });
 

            });
        });
    };

    CICD.prototype.gitPullRequestProxy = function (requestBody) {
        const self = this;
        const slack = self.getSlack();

        // first make sure, the body has the right format
        return self.gitPullRequestProxyConvertBody(requestBody).then((body) => {
            // bypass the message to the slack channel
            return slack.pullRequest.send(body).catch((e) => { 
                console.log(e);
            }).then(() => body);

        }).then((body) => {

            const regex = /^(\S+)-@([a-f0-9]{32})$/gi;
            let updateSetId;

            // target must be master
            if (body.target.branch != 'master')
                throw Error("target must be 'master'", body.target.branch);

            // search for update-set sys-id
            var checkMatch = regex.exec(body.source.branch);
            if (checkMatch && checkMatch.length) {
                updateSetId = checkMatch[2];
            } else {
                throw Error("source branch is invalid", body.source.branch);
            }

            return { body: body, updateSetId: updateSetId };

        }).then(({body, updateSetId}) => {

            // check if it needs any interaction with the update-set
            var action = (body.action || '').toLowerCase();
            var decline = action.includes('decline'),
                merge = action.includes('merge'),
                deleted = action.includes('delete');
            if (!decline && !merge && !deleted) {
                return;
            }

            console.log("action", action, updateSetId);

            return Promise.try(() => {
                // get the update-set form the db
                return this.db.us.find({
                    updateSetId: updateSetId
                });
            }).then((us) => {
                if (us.length === 0) {
                    throw Error(`UpdateSet not found with ID ${updateSetId}`);
                }
                return us[0];

            }).then((us) => {
                
                //console.log('job %j', us);
                var config = us.config;
                config.settings = assign({}, self.settings);

                return Promise.try(() => {
                    if (merge && (config.deploy && config.deploy.host && config.deploy.host.name)) {
                        return self.deployUpdateSet(config);
                    }
                }).then(() => {
                    return self.build.setProgress({
                        client: self.getClient(config),
                        config: config
                    }, ((merge) ? this.build.COMPLETE : this.build.CODE_REVIEW_REJECTED));
                });
            });
        });
    };


    CICD.prototype.server = require('./prototype/server');

    CICD.prototype.worker = require('./prototype/worker');

    CICD.prototype.start = function () {
        const self = this;

        const cluster = require('cluster');
        const numCPUs = (process.env.CICD_EB_WORKER_CLUSTER_NUM && process.env.CICD_EB_WORKER_CLUSTER_NUM > 0) ? process.env.CICD_EB_WORKER_CLUSTER_NUM : require('os').cpus().length;

        if (cluster.isMaster) {

            console.log('Starting Server process.');
            self.server();

            console.log(`Master ${process.pid} is running. Starting ${numCPUs} clients.`);
            for (let i = 0; i < numCPUs; i++) {
                console.log(`Forking process number ${i}...`);
                cluster.fork();
            }
        } else {
            self.worker();
        }
    };

  
    /**
     * Get Meta information from remote SNOW env
     * @param {*} ctx the context inc remote client
     * @returns {Promise<Array>} list of files (class / sysid)
     */
    CICD.prototype.getApplicationFiles = function (ctx) {
        const config = ctx.config;
        const param = {
            tableName: 'sys_metadata',
            options: {
                qs: {
                    sysparm_query: `sys_scope=${config.application.id}`,
                    sysparm_fields: 'sys_id, sys_class_name'
                }
            }
        };
        return ctx.remote.getFilesFromTable(param);
    };

    return CICD;
})();

module.exports = CICD;