require('dotenv').config();

require('console-stamp')(console, {
    pattern: 'HH:MM:ss.l',
    metadata: `[${process.pid}]`.padEnd(8),
    colors: {
        stamp: ['blue'],
        label: ['white'],
        metadata: ['green']
    }
});

const Promise = require('bluebird');
const assign = require('object-assign-deep');
const path = require("path");
const fs = Promise.promisifyAll(require("fs-extra"));
const camelCase = require('camelcase');
const stripAnsi = require('strip-ansi');

const SnProject = require("sn-project");
const EventBusJob = require('./eb/job');


const promiseFor = Promise.method((condition, action, value) => {
    if (!condition(value))
        return value;
    return action(value).then(promiseFor.bind(null, condition, action));
});

const CICDInt = require('./cicdInt');

const CICD = (function () {

    /**
     * Constructor 
     *
     * @param {*} options     
     */
    const CICD = function (options) {

        console.log('\n' + ': '.repeat(70));

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
                    const isLibrary = (fArr.length > 0 && fArr[1] === 'js'),
                        libName = camelCase(fArr[0]);
                    if (isLibrary) {
                        if (modules[libName]){
                            console.warn(`Overloading Module: '${libName}' from Path: ${path.join(fullDir, file)}`);    
                        } else {
                            //console.log(`Loading Module: '${libName}' from Path: ${path.join(fullDir, file)}`);
                        }
                        modules[libName] = require(path.join(fullDir, file));
                    }
                });
            }
            return modules;
        }, {});

        //const projectTemplateDir = false;
        // lookup project config templates directory
        const projectTemplateDir = moduleDirs.reduce((config, dir) => {
            if (config)
                return config;
            
            const buildConfig = path.join(dir, 'project-templates', 'build-config.json');
            if (fs.existsSync(buildConfig)) {
                return path.dirname(buildConfig);
            }
        }, null);
            
        if (typeof options == 'string') {
            options = path.resolve(options);
            if (fs.existsSync(options)) {
                console.log("loading options from file", options);
                options = JSON.parse(fs.readFileSync(options, 'utf8'));
            }
        }

        const tempDir = require('os').tmpdir();
        self.settings = assign({
            dataStore: {
                type: 'nedb',
                path: path.join(process.cwd(), 'db')
            },
            projectTemplateDir: projectTemplateDir,
            buildConfig : (projectTemplateDir) ? require(path.join(projectTemplateDir, 'build-config.json')) : {
                files: [], gulp: {}
            },
        }, options || {}, {
            server: {
                port: parseInt((process.env.CICD_WEB_HTTPS_PORT) ? process.env.CICD_WEB_HTTPS_PORT : process.env.CICD_WEB_HTTP_PORT, 10),
                hostName: `${(process.env.CICD_WEB_HTTPS_PORT) ? 'https' : 'http'}://${process.env.CICD_WEB_HOST_NAME}`
            },
            proxy: {
                proxy: process.env.PROXY_HTTPS_PROXY,
                strictSSL: process.env.PROXY_STRICT_SSL
                },
            gitRepoRootDir: (process.env.CICD_CODE_DIRECTORY) ? path.resolve(process.env.CICD_CODE_DIRECTORY) : path.resolve(tempDir, 'git-root'),
            tempBuildRootDir: (process.env.CICD_TEMP_DIRECTORY) ? path.resolve(process.env.CICD_TEMP_DIRECTORY) : path.resolve(tempDir, 'temp-build'),
            documentsRootDir: (process.env.CICD_DOC_DIRECTORY) ? path.resolve(process.env.CICD_DOC_DIRECTORY) : path.resolve(tempDir, 'doc-root')
        });
        
        return {
            start: () => {
                return self.start();
            },
            worker: () => {
                return self.worker();
            }
        };
    };

    CICD.prototype = new CICDInt();

    /** 
     * Basic setup used in  worker() and server()
     * @param {*} mode WORKER or SERVER
     * @returns {Promise}
     */
    CICD.prototype.init = function (mode) {

        const self = this;
        self.mode = mode;

        if (self._init !== undefined)
            return Promise.resolve(true);

        self._init = true;
        console.log('INIT\t', 'mode', mode);

        /*
            WORKER Setup
        */
        if (self.SERVER !== mode) {
            /*
                Configure DB connection to Server (via sockets)
            */
            return Promise.try(() => {
                self.db = require('./prototype/load-dao').call(self);
                console.log('INIT\t', 'db-type', self.db.type);
            });
        }

        /*
            SERVER Setup
        */
        return Promise.try(() => {
            if ('nedb' == self.settings.dataStore.type) {
                const Datastore = require('nedb');
                Object.keys(self.dataStore).forEach((collection) => {
                    const coll = new Datastore({
                        filename: path.join(self.settings.dataStore.path, `${collection}.db`),
                        autoload: true
                    });
                    Promise.promisifyAll(coll);
                    self.dataStore[collection] = coll;
                });
            }
        }).then(()=>{
            /*
                Configure DB 
            */
            self.db = require('./prototype/load-dao').call(self);
            console.log('INIT\t', 'db-type', self.db.type);
        }).then(() => {
            /*
                reset all update-set running flag
            */
            return self.db.us.find({}).then((result) => {
                result.forEach((us) => {
                    if (us.running) {
                        us.running = false;
                        self.db.us.update(us);
                    }
                });
            });
        }).then(() => {
            /*
                TODO
                also reset the self.db.run flags to eg 'failed' if was 'running'
            */
            return self.db.run.find({}).then((result) => {
                result.forEach((run) => {
                    if (run.running) {
                        run.running = false;
                    }
                    run.state = run.state || 'failed';
                    run.deployState = null;
                    self.db.run.update(run);
                });
            });
        });

    };

    /**
     * Slack client
     * 
     * @param {*} config the config object
     * @returns {Slack} 
     */
    CICD.prototype.getSlack = function () {
        const self = this;
        
        return new self.Slack({
            active: process.env.CICD_SLACK_ENABLED || false,
            webhookUri: process.env.CICD_SLACK_WEBHOOK,
            channel: process.env.CICD_SLACK_CHANNEL_OVERRIDE
        });
    };

    /**
     * Git client
     * 
     * @param {*} config the config object
     * @returns {Git} 
     */
    CICD.prototype.getGit = function (config) {
        if (!config)
            return null;
        
        const self = this;
        config.git.dir = path.join(config.build.applicationId, (config.build.sequence).toString());

        return new self.Git({
            dir: config.application.dir.code,
            gitignore: ['/config/', '/test/', '/*.*', '/docs*/', '!.gitignore'],
            remoteUrl: config.git.remoteUrl,
            quiet: true,
            user :{
                name: process.env.CICD_GIT_USER_NAME || null,
                email: process.env.CICD_GIT_USER_EMAIL || null
            }
        });
    };

    /**
     * Representation of ServiceNow XML files as NodeJs project
     * 
     * @param {*} config the config object
     * @returns {SnProject} 
     */
    CICD.prototype.getProject = function (config) {
        const self = this;
        if (!config)
            return null;
        
        return new SnProject({
            dir: config.application.dir.code,
            appName: config.application.name,
            dbName: config.master.name,
            organization: config.application.organization,
            includeUnknownEntities: config.application.includeUnknownEntities,
            templateDir: self.settings.projectTemplateDir,
            templates: self.settings.buildConfig.files
        });
    };

    /**
     * To interact with ServiceNow.
     * The credentials to connect are taken from process.env.CICD_CI_ < HOST > _USER and fallback to process.env.CICD_CI_USER
     * 
     * @param {*} config the config object
     * @returns {SnClient} 
     */
    CICD.prototype.getClient = function (config) {
        const self = this;
        if (!config || !config.host)
            return null;
        
        const m = config.host.name.match(/(?:http[s]?:\/\/)([^\.]*)([^:\/]*)/i);
        const varName = `CICD_CI${((m) ? `_${m[1].toUpperCase()}` : '')}_USER`;

        const username = process.env[`${varName}_NAME`] || process.env.CICD_CI_USER_NAME;
        const password = process.env[`${varName}_PASSWORD`] || process.env.CICD_CI_USER_PASSWORD;

        return new self.SnClient({
            hostName: config.host.name,
            proxy: self.settings.proxy,

            username: username,
            password: password,

            debug: false,
            silent: true,
            jar: config.host.jar || false
        });
    };


    /**
     * Get a ServiceNow rest response value
     * @param {*} element name of the element
     * @returns {*} value of the element
     */
    CICD.prototype.getValue = function (element) {
        if (element === undefined)
            return undefined;
        return (element.value !== undefined) ? element.value.trim() : element;
    };

    /**
     * Get a ServiceNow rest response display-value
     * @param {*} element name of the element
     * @returns {*} display-value of the element, value fallback
     */
    CICD.prototype.getDisplayValue = function (element) {
        const self = this;
        if (element === undefined)
            return undefined;
        return (element.display_value !== undefined) ? element.display_value.trim() : self.getValue(element);
    };


    /** 
     * Finalize a run and update the DB
     * 
     * @param {*} config the config object
     * @param {*} error in case of error, the error
     * @returns {Promise}
     */
    CICD.prototype.finalizeRun = function (config, error) {
        const self = this;
        return Promise.try(() => {
            if (error) {
                return self.addStep(console, config, 'finalizeRun-error', error);
            }
        }).then(() => {
            if (config.build.runId) {
                return self.db.run.get(config.build.runId).then((run) => {
                    //run.running = false;
                    run.state = (error) ? 'failed' : 'successful';
                    run.running = false;
                    return self.db.run.update(run).then(()=> run);
                }).then((run) => {
                    
                    return self.db.us.get(run.usId).then((us) => { 
                        if (!error)
                            us.lastSuccessfulRun = run;
                    
                        us.running = false;
                        return self.db.us.update(us);
                    });
                });
            }
        }).catch((e) => {
            console.error('CICD.prototype.finalizeRun', e);
        });
    };

    
    /** 
     * Log a step message to the DB and console
     * 
     * @param {*} config the config object
     * @param {*} state the message
     * @param {*} error in case of error, the error
     * @returns {Promise}
    */
    CICD.prototype.addStep = function (logger = console, config, state, error) {
        const self = this;
        return Promise.try(() => {
            if (!config) {
                throw Error(`addStep, no run instance found. State: ${state}`);
            }
            if (!config.build || !config.build.runId) {
                throw Error(`addStep, no run instance found. State: ${state}`);
            }

            const runId = config.build.runId;
            const step = {
                runId: runId,
                state: stripAnsi(state),
                ts: new Date().getTime()
            };
            if (error)
                step.error = error.message || JSON.stringify(error);

            logger.log(step.state, step.error || '');

            return self.db.step.insert(step);
        }).catch((e) => {
            logger.error('CICD.prototype.addStep', e);
        });
    };


    /**
     * Add additional information about the update-set form ServiceNow to the config object
     * 
     * @param {*} config the config object
     * @returns {Promise}
     */
    CICD.prototype.getUpdateSetDetails = function (config) {
        const self = this;

        const client = self.getClient(config);

        return client.getUpdateSetDetails(config.updateSet).then((updateSetObj) => {
            config.updateSet = updateSetObj;
        });
    };


    /**
     * Get User information from ServiceNow. Information are cached based on userId
     * 
     * @param {SnClient} client the the snClient object
     * @param {*} userId the use to lookup
     * @returns {Promise<Object>}
     */
    CICD.prototype.getUser = function (client, userId) {
        const self = this;
        return Promise.try(() => {
            let user = self.userCache[userId];
            if (user)
                return user;

            return client.getUserById(userId).then((result) => {
                if (result.length) {
                    const tmp = result[0];
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
     * Change the status of the update-set in ServiceNow
     * @param {Object} args
     * @param {*} args.config the config object
     * @param {*} state the state to be set
     * @returns {Promise}
    */
    CICD.prototype.setProgress = function (config, state) {
        const self = this;
        const client = self.getClient(config);

        console.log('setProgress', state);
        return Promise.try(() => {
           if (!client) {
                console.error("context not correctly created");
                return;
            }
            const updateSetId = config.updateSet.sys_id || config.updateSet;
            return client.setUpdateSetStatus(updateSetId, state);
        });
    };

      
    /**
     * Get Meta information from remote SNOW env
     * @param {Object} args
     * @param {*} args.config the config object
     * @returns {Promise<Array>} list of files (class / sysid)
     * @returns {Promise}
     */
    CICD.prototype.getApplicationFiles = function (config) {
        const self = this;
        const remote = self.getClient(config.master);

        const param = {
            tableName: 'sys_metadata',
            options: {
                qs: {
                    sysparm_query: `sys_scope=${config.application.id}`,
                    sysparm_fields: 'sys_id, sys_class_name'
                }
            }
        };
        return remote.getFilesFromTable(param);
    };

    /**
     * Get all ATF test suites existing on the SOURCE environment
     * @param {Object} args
     * @param {*} args.config the config object 
     * @returns {Promise}
     */
    CICD.prototype.getApplicationTestSuites = function (config) {
        const self = this;
        const client = self.getClient(config);

        const param = {
            tableName: 'sys_metadata',
            options: {
                qs: {
                    sysparm_query: `sys_class_name=sys_atf_test_suite^sys_scope=${config.application.id}`,
                    sysparm_fields: 'sys_id, sys_class_name'
                }
            }
        };
        return client.getFilesFromTable(param).map(function (applicationTestSuite) {
            return {
                className: applicationTestSuite.sys_class_name,
                sysId: applicationTestSuite.sys_id
            };
        });
    };

    /**
     * Get all ATF test cases existing on the SOURCE environment
     * @param {*} config 
     */
    CICD.prototype.getApplicationTests = function (config) {
        const self = this;
        const client = self.getClient(config);

        const param = {
            tableName: 'sys_metadata',
            options: {
                qs: {
                    sysparm_query: `sys_class_name=sys_atf_test^sys_scope=${config.application.id}`,
                    sysparm_fields: 'sys_id, sys_class_name'
                }
            }
        };
        return client.getFilesFromTable(param).map(function (applicationTest) {
            return {
                className: applicationTest.sys_class_name,
                sysId: applicationTest.sys_id
            };
        });
    };




    /**
     * Group the filesOnDisk array by updatedBy (user)
     * 
     * @param {Array} filesOnDisk 
     * @returns {Promise<Object>}
     */
    CICD.prototype.getFilesByUpdatedBy = function (filesOnDisk) {
        const self = this;
        return Promise.reduce(filesOnDisk, (fileByUpdatedBy, file) => {
            const updatedBy = file.updatedBy;

            if (fileByUpdatedBy[updatedBy] === undefined)
                fileByUpdatedBy[updatedBy] = [];

            fileByUpdatedBy[updatedBy].push(file.path);
            return fileByUpdatedBy;
        }, {});
    };


    /**
     * Group and process all files by className
     * 
     * @param {Object} args
     * @param {Object} args.config the config object
     * @param {Array} applicationFiles {sys_id, u_file_class, u_file}
     * @returns {Promise}
     */
    CICD.prototype.processFilesByClass = function (config, applicationFiles) {
        const self = this;
        
        const remote = self.getClient(config.master);
        const project = self.getProject(config);

        applicationFiles = applicationFiles || [];
        /*
            sort applicationFiles by className
            this allows us to reduce the calls to one per class/table name
            { classNameX : [sysId,sysId], classNameY : [sysId,sysId] }
        */
        console.log("Process files by class");
        return Promise.reduce(applicationFiles, (applicationFilesByClass, file) => {
            const className = file.className || file.sys_class_name;
            if (applicationFilesByClass[className] === undefined)
                applicationFilesByClass[className] = [];

            applicationFilesByClass[className].push(file);
            return applicationFilesByClass;

        }, {}).then((applicationFilesByClass) => {

            let filesOnDisk = [];
            // callback per chunk
            return Promise.each(Object.keys(applicationFilesByClass), (className) => {
                console.log("\t", className);
                return self.processFiles({remote: remote, project: project}, className, applicationFilesByClass[className]).then((filesUpdated) => {
                    filesOnDisk = filesOnDisk.concat(filesUpdated);
                });
            }).then(() => {
                return filesOnDisk;
            });
        });
    };


    /**
     * Process all files of one class type
     * 
     * @param {Object} args
     * @param {Object} args.remote the remote client
     * @param {Object} args.project the project
     * @param {String} className 
     * @param {Array} applicationFiles 
     * @returns {Promise}
     */
    CICD.prototype.processFiles = function ({remote, project}, className, applicationFiles) {
        const self = this;
        
        return Promise.try(() => {
            // get the request params for this entity className
            return project.getEntityRequestParam(className);

        }).then((entityRequestParam) => {

            const fileSysIds = applicationFiles.map((file) => {
                return file.sysId || file.sys_id;
            });
            const hasQuery = (entityRequestParam.queryFieldNames.length);
            let query = `sys_idIN${fileSysIds.join(',')}`;

            if (hasQuery) {
                const entity = project.getEntity(className);

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
            let filesOnDisk = [];

            return remote.getFilesFromTable(requestParam, (files) => {

                // parse and save file to disk
                return Promise.each(files, (file) => {

                    // in case the file has no sys_class_name parameter (like 'sys_update_set'), add the tableName as it
                    //file.sys_class_name = className;
                    let appName = 'Global';
                    let scopeName = 'global';
                    let updatedBy = 'system';

                    const appNameObj = file['sys_scope.name'] || appName;
                    appName = appNameObj.display_value || appNameObj.value || appNameObj;

                    const scopeNameObj = file['sys_scope.scope'] || scopeName;
                    scopeName = scopeNameObj.display_value || scopeNameObj.value || scopeNameObj;

                    const updatedByField = file.sys_updated_by || file.sys_created_by || updatedBy;
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


  




    /** 
     * The request proxy for pull requests.
     * In case of "merge", the update-set is deployed if its configuration is: config.deploy.onBuildPass
     * <p>
     * All updates of pull requests must be sent to POST:/pull_request and are handled here.
     * If required the request body can be modified in self.gitPullRequestProxyConvertBody()
     * </p>
     * 
     * Mapped to /pull_request
     * 
     * @param {*} requestBody the payload from the PR system
     * @returns {Promise<void>}
    */
    CICD.prototype.pullRequest = function (requestBody) {
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
            const checkMatch = regex.exec(body.source.branch);
            if (checkMatch && checkMatch.length) {
                updateSetId = checkMatch[2];
            } else {
                throw Error("source branch is invalid", body.source.branch);
            }

            return { body: body, updateSetId: updateSetId };

        }).then(({ body, updateSetId }) => {

            // check if it needs any interaction with the update-set
            const action = (body.action || '').toLowerCase();
            const decline = action.includes('decline'),
                merge = action.includes('merge'),
                deleted = action.includes('delete');

            if (!decline && !merge && !deleted) {
                return;
            }

            return Promise.try(() => {
                return self.db.us.findOne({ updateSetId });
            }).then((us) => {
                if (!us || !us.runId) {
                    throw Error(`UpdateSet or Run not found with ID ${updateSetId}`);
                }
                // disable the pull request
                us.pullRequestRaised = false;
                return self.db.us.update(us).then(()=> us);
            }).then((us) => {
                // lookup corresponding 'run'
                const runId = us.runId;
                return self.db.run.get({ _id: runId }).then((run) => {
                    if (!run)
                        throw Error(`Run not found with ID ${runId}`);
                    return run;
                });

            }).then((run) => {

                const config = run.config;
                if (!config)
                    throw Error("No configuration found for this run");
                
                const step = (message, error) => {
                    return self.addStep(console, config, `${path.basename(__filename).split('.')[0]}.gitPullRequestProxy : ${message}`, error);
                };

                if (!merge)
                    return step(`pull request result for '${config.updateSet.name}' is ${action}`).then(() => {
                        return self.setProgress(config, self.build.CODE_REVIEW_REJECTED);
                    });

                if (!(config.deploy && config.deploy.onBuildPass)) {
                    return step(`deployment 'onBuildPass' is disabled!`);
                }

                return Promise.try(() => {
                    return step(`deploy update-set ${config.updateSet.name}`);
                }).then(() => {
                    // run 'deployUpdateSet' in the background
                    /*
                        TODO
                        this could potentially also be a 'EbQueueJob'
                    */
                    return new EventBusJob({ name: 'deployUpdateSet', background: true }, { commitId: run.commitId });
                });
            });
        });
    };


    /** 
     * The Web Server components
    */
    CICD.prototype.server = require('./prototype/server');

    /** 
     * To run the worker run new CICD().worker();, this will start worker nodes.
     * 
     */
    CICD.prototype.worker = require('./prototype/worker');


    /** 
     * To run the server execute new CICD().start();
     * This will start the server and embedded worker nodes.
     */
    CICD.prototype.start = require('./prototype/start');


    return CICD;
})();

module.exports = CICD;