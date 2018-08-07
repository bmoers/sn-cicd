
//process.env['BLUEBIRD_DEBUG'] = true;
//process.env['BLUEBIRD_LONG_STACK_TRACES'] = true;

var Promise = require('bluebird');
var etparse = require('elementtree').parse,
    ObjectAssignDeep = require('object-assign-deep'),
    path = require("path"),
    fs = Promise.promisifyAll(require("fs-extra"));

var SnRestClient = require("sn-rest-client");
var SnProject = require("sn-project");


var Git = require("./git");
var Slack = require("./slack");
const get = (p, o) => p.reduce((xs, x) => (xs && xs[x]) ? xs[x] : null, o);

var promiseFor = Promise.method((condition, action, value) => {
    if (!condition(value))
        return value;
    return action(value).then(promiseFor.bind(null, condition, action));
});

var CICDInt = require('./cicdInt');

var CICD = (function () { 

    var settings = null,
        userCache = {},
        dataStore = {
            application : null,
            us: null,
            run: null,
            step: null
        };
    

    var CICD = function (options) {
        
        if (typeof options == 'string') {
            options = path.resolve(options);
            if (fs.existsSync(options)) {
                console.log("loading options from file", options);
                options = JSON.parse(fs.readFileSync(options, 'utf8'));    
            } else {
                console.warn("config file not found under:", options);
            }
            
        }

        settings = ObjectAssignDeep({
            dataStore: {
                type: 'nedb', path: path.join(process.cwd(), 'db')
            },
            gitRepoRootDir: path.resolve(require('os').tmpdir(), 'git-root'),
            tempBuildRootDir: path.resolve(require('os').tmpdir(), 'temp-build'),
            documentsRootDir: path.resolve(require('os').tmpdir(), 'doc-root'),
            proxy: {
                proxy: process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy,
                strictSSL: false
            },
            slack: {
                active: false,
                webhookUri: null,
                channel: null
            },
            browser: {
                bin: '',
                arg: []
            },
            server:{
                port: 3001,
                hostName: 'http://localhost'
            }
        }, options || {});

        if ('nedb' == settings.dataStore.type) {
            var Datastore = require('nedb');
            Object.keys(dataStore).forEach((collection) => {
                var coll = new Datastore({
                    filename: path.join(settings.dataStore.path, `${collection}.db`),
                    autoload: true
                });
                Promise.promisifyAll(coll);
                dataStore[collection] = coll;
            });
        }
    };

    CICD.prototype = new CICDInt();

    var getSlack = () => {
        //console.log("settings.slack %j", settings.slack);
        return new Slack(settings.slack);
    };
    
    var getGit = (ctx) => {
        var config = ctx.config,
            git;

        config.application.git.dir = path.join(config.application.id, (ctx.config.build.sequence).toString());

        ctx.git = git = new Git({
            dir: ctx.config.application.dir.code,
            gitignore: ['/config/', '/test/', '/*.*', '/docs*/', '!.gitignore'],
            remoteUrl: config.application.git.remoteUrl,
            quiet: true
        });
        return git;
    };

    var getProject = (config) => {
        return new SnProject({
            dir: config.application.dir.code,
            appName: config.application.name,
            organization: config.application.organization
        });
    };

    var getClient = (config) => {
        return new SnRestClient({
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


    var getValue = (element) => {
        if (element === undefined)
            return undefined;
        return (element.value !== undefined) ? element.value : element;
    };

    var getDisplayValue = (element) => {
        if (element === undefined)
            return undefined;
        return (element.display_value !== undefined) ? element.display_value : getValue(element);
    };


    var configureProjectFile = function (files, ctx) {
        var project = ctx.project,
            client = ctx.client,
            config = ctx.config;

        files = files || {
            updatedFiles: [],
            deletedFiles: []
        };

        console.log("Configure test cases");
        return Promise.try(() => {
            // get default config
            return project.getConfig().then((defaultConfig) => {
               return ObjectAssignDeep(defaultConfig, config);
            });
        }).then((testConfig) => {
            // set the browser to be used in ATF
            testConfig.atf.browser = settings.browser;

            // remove the run part

            // commented for testing
            //delete testConfig.build.run;
            
            return testConfig; 
        }).then((testConfig) => {
            testConfig.lint = files.updatedFiles.reduce((prev, file) => {
                if (file.path.endsWith('.js')) {
                    prev.push(file.path);
                }
                return prev;
            }, []);
            
            if (testConfig.lint.length === 0)
                testConfig.lint.push('./sn/'); // to ensure the lint process does not fail in case of no files created.
            
            return testConfig;
        }).then((testConfig) => {
        
            var fileSource = (testConfig.atf.updateSetOnly) ? config.branchName : undefined;

            return project.getTestSuites(fileSource).then((testSuites) => {
                testSuites.forEach((suite) => {
                    testConfig.atf.suites.push(suite.sysId);
                });
                return testConfig;
            });

        }).then((testConfig) => {

            var fileSource = (testConfig.atf.updateSetOnly) ? config.branchName : undefined;

            /*

                TODO 
                    check if this is still valid with the filter on fileSource 
            */

            return project.getTests(fileSource).then((tests) => {

                // safe the whole list first
                tests.forEach((test) => {
                    testConfig.atf.tests.push(test.sysId);
                });

                /*
                    get all tests which are assigned to a Suite
                */
                return client.get({
                    url: 'api/now/table/sys_atf_test_suite_test',
                    qs: {
                        'sysparm_query': 'test_suite.active=true^test.active=true',
                        'sysparm_fields': 'test',
                        'sysparm_exclude_reference_link': true
                    }
                }).then((files) => {

                    var assignedTests = files.reduce((prev, file) => {
                        return prev.concat(file.test);
                    }, []);

                    // remove all test from the config which are part of a Suite
                    testConfig.atf.tests = testConfig.atf.tests.filter((test) => {
                        return assignedTests.indexOf(test) === -1;
                    });

                    return testConfig;
                });

            });
        }).then((testConfig) => {
            return project.setConfig(testConfig);
        });

    };

    var houseKeeping = function (app) {

        var maxRun = 20;

        console.log('*** house keeping ***');
        return Promise.try(() => {
            return this.db.us.find({ app: app._id });
        }).then((usList) => {
            console.log('check all update-set to be deleted. total #', (usList || []).length);

            return Promise.each(usList || [], (us) => {

                return Promise.try(() => {
                    return this.db.run.find({ us: us._id });
                }).then((runList) => {

                    console.log(`us: ${us._id} previous runs # ${runList.length}`);

                    // isolate the old ones
                    var sortedRun = runList.sort((a, b) => {
                        return a.ts < b.ts;
                    });
                    var length = -1 * (sortedRun.length - maxRun);
                    if (length < 0) {
                        console.log(`\tto be deleted # ${length}`);
                        var removeRun = sortedRun.slice(length);
                        return Promise.each(removeRun || [], (run) => {
                            // find and delete steps for the runs to be deleted
                            console.log(`\tremove all steps of run ${run._id}`);
                            return this.db.step.find({ run: run._id }).then((stepList) => {
                                return Promise.each(stepList || [], (step) => {
                                    return this.db.step.delete(step);
                                });
                            }).then(() => {
                                console.log(`\tdelete the run # ${run._id}`);

                                return Promise.each(Object.keys(run.dir || {}), (dir) => {
                                    var directory = run.dir[dir];
                                    console.log(`\t\tdelete all files in '${directory}'`);
                                    return fs.removeAsync(directory);
                                }).then(() => {
                                    return this.db.run.delete(run);

                                });
                            });
                        });
                    }
                });
            });

        });
    };

    var getApplication = function (application) {
        var app = {
            _id: application.id,
            application: application
        };
        
        return this.db.application.get({ _id: app._id }).then((result) => { 
            return Promise.try(() => {
                if (!result) {
                    return this.db.application.insert(app).then((result) => {
                        app = result;
                    });
                } else {
                    return Promise.try(() => {
                        // in case the application info change
                        return this.db.application.update(app).then(() => {
                            app = result;
                        });
                    }).then(() => {
                        return houseKeeping.call(this, app);
                    });
                }
            }).then(() => {
                return app;
            }); 
        });
    };



    var getUpdateSet = function (config) {

        var app = config.build.run.app;
        var us = {
            updateSetId: config.updateSet.sys_id,
            updateSet: config.updateSet,
            name: config.updateSet.name,
            app: app._id,
            running: false,
            lastBuildSequence: 0,
            lastSuccessfulRun: null,
            state: 'pending'
        };

        return this.db.us.find({ app: us.app, updateSetId: us.updateSetId }).then((result) => {
            //console.log('getUpdateSet find', result);
            return Promise.try(() => {
                if (result && result.length) { 
                    us = result[0];                    
                } else {
                    return this.db.us.insert(us).then((result) => {
                        us = result;
                    });
                }
            }).then(() => {
                return us;
            });
        });
    };

    var setUpdateSet = function (config, entry, error) {

        return Promise.try(() => {
            if (error) {
                return addStep.call(this, config, 'setUpdateSet-error', error);
            }
        }).then(() => {
            
            if (config.build.run.us) {
                if (entry && config._entry == entry) { // only complete the job if started n sam entry
                    config.build.run.us.running = false;
                    config.build.run.us.state = config.build.run.instance.state = (error) ? 'failed' : 'successful';

                    if (!error && config.build.run.instance) {
                        config.build.run.us.lastSuccessfulRun = config.build.run.instance;
                    }
                }
                return this.db.us.update(config.build.run.us).then(() => {
                    return this.db.run.update(config.build.run.instance);
                });
            }
        });
        
    };

    var newRun = function (us) {
        var run = {
            us: us._id,
            app: us.app,
            sequence: us.lastBuildSequence,
            state: 'pending',
            ts: new Date().getTime()
        };
        return this.db.run.insert(run);
    };


    var addStep = function (config, state, error) {
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
            
            return this.db.step.insert(step);
        });    
    };

    var loadUpdateSet = (ctx) => {
        var client = ctx.client,
            config = ctx.config;

        return Promise.try(() => {
            if (typeof config.updateSet == 'object')
                return;

            return client.get({
                url: 'api/now/table/sys_update_set/'.concat(config.updateSet),
                qs: {
                    sysparm_display_value: 'all',
                    sysparm_exclude_reference_link: true,
                    sysparm_fields: ['sys_id', 'application.name', 'application.scope', 'name', 'description', 'state', 'remote_sys_id', 'sys_created_by', 'sys_created_on', 'sys_updated_by', 'sys_updated_on'].join(',')
                }
            }).then((result) => {
                //console.dir(result, { depth: null, colors: true });
                if (result.length) {
                    var us = result[0];
                    config.updateSet = {
                        sys_id: config.updateSet,
                        appName: getDisplayValue(us['application.name']),
                        scopeName: getDisplayValue(us['application.scope'])
                    };

                    ['name', 'description', 'state', 'remote_sys_id', 'sys_created_by', 'sys_created_on', 'sys_updated_by', 'sys_updated_on'
                    ].forEach((field) => {
                        config.updateSet[field] = getValue(us[field]);
                    });
                } else {
                    throw Error(`UpdateSet not found with ID ${config.updateSet}`); 
                }
            });

        }).then(() => {
            // set the branch name
            config.branchName = config.updateSet.name.concat('-@').concat(config.updateSet.sys_id);
        });
    };

    var getUser = function (client, userId) {
        return Promise.try(() => {
            var user = userCache[userId];
            if (user)
                return user;

            return client.get({
                url: 'api/now/table/sys_user',
                qs: {
                    'sysparm_fields': 'sys_id, name, email',
                    'sysparm_limit': 1,
                    'sysparm_query': 'user_name='.concat(userId)
                }
            }).then((result) => {
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
                userCache[userId] = user;
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
    var getFilesByUpdatedBy = function (filesOnDisk) {

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
    var processFilesByClass = function (ctx, applicationFiles) {
        var project = ctx.project,
            client = ctx.remote,
            config = ctx.config;

        applicationFiles = applicationFiles || [];
        /*
            sort applicationFiles by className
            this allows us to reduce the calls to one per class/table name
            { classNameX : [sysId,sysId], classNameY : [sysId,sysId] }
        */
        console.log("Process files by class");
        return Promise.reduce(applicationFiles, (applicationFilesByClass, file) => {
            var className = file.className;
            if (applicationFilesByClass[className] === undefined)
                applicationFilesByClass[className] = [];

            applicationFilesByClass[className].push(file);
            return applicationFilesByClass;

        }, {}).then((applicationFilesByClass) => {

            var filesOnDisk = [];
            // callback per chunk
            return Promise.each(Object.keys(applicationFilesByClass), (className) => {
                console.log("\t", className);
                return processFiles(ctx, className, applicationFilesByClass[className]).then((filesUpdated) => {
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
    var processFiles = function (ctx, className, applicationFiles) {
        var project = ctx.source,
            client = ctx.remote,
            config = ctx.config;

        return Promise.try(() => {

            // get the request params for this entity className
            return project.getEntityRequestParam(className);

        }).then((entityRequestParam) => {

            var fileSysIds = applicationFiles.map((file) => {
                return file.sysId;
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
                url: 'api/now/table/' + entityRequestParam.className,
                qs: {
                    sysparm_query: query,
                    sysparm_display_value: 'all', //entityRequestParam.displayValue || false,
                    active: true,
                    sysparm_fields: entityRequestParam.fieldNames.map(function (field) {
                        return field.name;
                    }).join(',') || null
                }
            };

        }).then((requestParam) => {
            var filesOnDisk = [];
            return client.get(requestParam, (files) => {

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
                        hostName: client.getHostName(),
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

    CICD.prototype.db.application = {
        get: function ({ _id }) {
            return Promise.try(() => {
                return dataStore.application.findOneAsync({ _id });
            });
        },
        insert: function (obj) {
            return Promise.try(() => { 
                return dataStore.application.insertAsync(obj);
            });
        },
        update: function ({ _id }) {
            return Promise.try(() => { 
                return dataStore.application.updateAsync({ _id }, arguments[0], { upsert: true });
            });
        },
        delete: function ({ _id }) {
            return Promise.try(() => { 
                return dataStore.application.removeAsync({ _id });
            });
        },
        find: function (query) {
            return Promise.try(() => {
                return dataStore.application.findAsync(query);
            });
        }
        
    };

    CICD.prototype.db.us = {
        get: function ({ _id }) {
            return Promise.try(() => {
                return dataStore.us.findOneAsync({
                    $or: [{
                        _id : _id
                    }, {
                        updateSetId: _id // to support URLs pointing only to the updateset sys_id
                    }]
                });
            });
        },
        insert: function (obj) {
            return Promise.try(() => {
                return dataStore.us.insertAsync(obj);
            });
        },
        update: function ({ _id }) {
            return Promise.try(() => {
                //console.log('dbstore.us.updateAsync', { _id }, arguments[0], { upsert: true });
                return dataStore.us.updateAsync({ _id }, arguments[0], { upsert: true });
            });
        },
        delete: function ({ _id }) {
            return Promise.try(() => {
                return dataStore.us.removeAsync({ _id });
            });
        },
        find: function (query) {
            return Promise.try(() => {
                return dataStore.us.findAsync(query);
            });
        }
    };

    CICD.prototype.db.run = {
        get: function ({ _id }) {
            return Promise.try(() => {
                return dataStore.run.findOneAsync({ _id });
            });
        },
        insert: function (obj) {
            return Promise.try(() => {
                return dataStore.run.insertAsync(obj);
            });
        },
        update: function ({ _id }) {
            return Promise.try(() => {
                return dataStore.run.updateAsync({ _id }, arguments[0], { upsert: true });
            });
        },
        delete: function ({ _id }) {
            return Promise.try(() => {
                return dataStore.run.removeAsync({ _id });
            });
        },
        find: function (query) {
            return Promise.try(() => {
                return dataStore.run.findAsync(query);
            });
        }
    };

    CICD.prototype.db.step = {
        get: function ({ _id }) {
            return Promise.try(() => {
                return dataStore.step.findOneAsync({ _id });
            });
        },
        insert: function (obj) {
            return Promise.try(() => {
                return dataStore.step.insertAsync(obj);
            });
        },
        update: function ({ _id }) {
            return Promise.try(() => {
                return dataStore.step.updateAsync({ _id }, arguments[0], { upsert: true });
            });
        },
        delete: function ({ _id }) {
            return Promise.try(() => {
                return dataStore.step.removeAsync({ _id });
            });
        },
        find: function (query) {
            return Promise.try(() => {
                return dataStore.step.findAsync(query);
            });
        }
    };


    CICD.prototype.build.setProgress = function (ctx, state) {
        var project = ctx.project,
            client = ctx.client,
            config = ctx.config,
            updateSetId = config.updateSet.sys_id || config.updateSet;
        console.log('setProgress', state);

        return Promise.try(() => {
            if (!client) {
                console.error("context not correctly created");
                return;
            }
            /* TODO, implement state machine to ensure the status is not overwritten wrongly 
            return client.get({
                url: 'api/now/table/sys_update_set/'.concat(updateSetId),
                qs: {
                    sysparm_fields: 'state'
                }
            }).then((results) => {
                var updateSetState = (results.length) ? results[0].state : 'undefined';
                if (this.build.CODE_REVIEW_PENDING == updateSetState)

            });
            */
            
            return client.put({ url: 'api/now/table/sys_update_set/'.concat(updateSetId) }, {
                state: state
            });
        });
    };


    CICD.prototype.configure = function (ctx, entry) {

        return Promise.try(() => {
            // copy global settings into config
            ctx.config.settings = ObjectAssignDeep({}, settings);

            if (entry && !ctx.config._entry)
                ctx.config._entry = entry;
            
            if (!get(['config', 'updateSet'], ctx)) {
                throw Error('Configuration Error: update set is not defined in config.updateSet');
            }

            if (!get(['config', 'host', 'name'], ctx)) {
                throw Error('Configuration Error: source server host name not defined in config.host.name');
            }
            
            // switch if masterBranch is enabled
            ctx.config.branch.enabled = (get(['config', 'branch', 'name'], ctx) && get(['config', 'branch', 'host', 'name'], ctx)) ? true : false;
            
            // switch if ATF is enabled
            ctx.config.atf.enabled = (get(['config', 'atf', 'credentials', 'oauth', 'accessToken'], ctx)) ? true : false;


        }).then(() => {
            if (!ctx.client)
                ctx.client = getClient(ctx.config);

        }).then(() => {
            return loadUpdateSet(ctx);

        }).then(() => {
            //console.dir(ctx.config, { depth: null, colors: true });
            // get the config object from the db
            if (!ctx.config.build.run.app) {

                return getApplication.call(this, ctx.config.application).then((app) => {
                    ctx.config.build.run.app = app;
                }).then(() => {
                    return this.db.application.update(ctx.config.build.run.app);
                });

            }

        }).then(() => {
            // get the job object from the db

            if (!ctx.config.build.run.us) {
                return getUpdateSet.call(this, ctx.config).then((us) => {
                    if (us.running) {
                        //throw 'job already running';
                        //console.warn('there is already a build job running for this update-set', ctx.config.build.run.app, us);
                        throw Error('there is already a build job running for this update-set');
                    } 
                    
                    us.lastBuildSequence++;
                    // always refresh the update-set
                    us.updateSet = ctx.config.updateSet;
                    us.name = ctx.config.updateSet.name;

                    us.running = true;
                    ctx.config.build.run.us = us;

                    return this.db.us.update(us);
                   
                }).then(() => {
                    // create a new run and increase the counter on the job
                    return newRun.call(this, ctx.config.build.run.us).then((run) => {
                        ctx.config.build.run.instance = run;
                    });

                }).then(() => {
                    ctx.config.build.sequence = ctx.config.build.run.instance.sequence;

                });
            }

        }).then(() => {

            ctx.config.application.dir = {
                code: path.resolve(ctx.config.settings.gitRepoRootDir, ctx.config.application.id, (ctx.config.build.sequence).toString()),
                doc: path.resolve(ctx.config.settings.documentsRootDir, ctx.config.application.id, (ctx.config.build.sequence).toString()),
                tmp: path.resolve(ctx.config.settings.tempBuildRootDir, ctx.config.application.id)
            };

            /*
            ctx.config.build.run.app
                the app
            ctx.config.build.run.us
                the update-set
            ctx.config.build.run.instance
                the current run instance

            http://localhost:8080/steps.html#/app/a8021fa7db6f8700dfa9b94ffe9619c2/us/HBdye96EpIgIbk7s/run/EafsrfGcc11Fve2H
            */
            
            ctx.config.application.docUri = `${settings.server.hostName}${(settings.server.port) ? `:${settings.server.port}` : ''}/steps.html#/app/${ctx.config.build.run.app._id}/us/${ctx.config.build.run.us._id}/run/${ctx.config.build.run.instance._id}`;
            
            /*
            // just in case, clean the target dir
            return Promise.each(Object.keys(ctx.config.application.dir), (key) => {
                var dirName = ctx.config.application.dir[key];
                return fs.removeAsync(dirName);
            });
            */

        }).then(() => {
            ctx.config.build.run.instance.dir = ctx.config.application.dir;
            return this.db.run.update(ctx.config.build.run.instance);

        }).then(() => {

            if (!ctx.git)
                ctx.git = getGit(ctx);
            
            return Promise.try(() => {
                //console.log('from branch name', ctx.config.branchName)
                return ctx.git.toBranchName(ctx.config.branchName).then((branchName) => {
                    ctx.config.branchName = branchName;
                    //console.log('to branch name', ctx.config.branchName)
                });
            }).then(() => {
                ctx.config.build.run.us.branchName = ctx.config.branchName;
                return this.db.us.update(ctx.config.build.run.us);
            }).then(() => {

                if (ctx.config.application.git.enabled === true) {

                    if (ctx.config._git === undefined) {
                        return Promise.try(() => {
                            return this.createRemoteRepo(ctx, ctx.config.application.git.repository);
                        }).then(() => {
                            return ctx.git.init();
                        }).then(() => {
                            ctx.config._git = 1;
                        });
                    }
                }
            });

        }).then(() => {

            if (!ctx.project) {
                ctx.project = getProject(ctx.config);

                // init local file directory, copy default files from template etc
                return ctx.project.setup();
                /*
                if (ctx.config._project === undefined) {
                    // init local file directory, copy default files from template etc
                    return ctx.project.setup().then(() => {
                        ctx.config._project = 1;
                    });
                }
                */
            }

        }).then(() => {
            // add config to update-set to be used in the deployment later (from the db)
            ctx.config.build.run.us.config = {
                build: {
                    requestor: ctx.config.build.requestor,
                    run: {
                        instance: {
                            _id: ctx.config.build.run.instance._id
                        }
                    }
                },
                updateSet: ctx.config.updateSet,
                application: ctx.config.application,
                host: ctx.config.host,
                branch: ctx.config.branch,
                deploy: ctx.config.deploy
            };
            return this.db.us.update(ctx.config.build.run.us);
        }).then(() => {
            return ctx;
        });
        
    };

    CICD.prototype.buildUpdateSetOnBranch = function (options, ctx) {
        var client,
            project,
            config,
            git,
            ctx = ctx || {
                config: null,
                client: null,
                project: null
            },
            error;

        ctx.config = config = ObjectAssignDeep({
            build: {
                requestor: {
                    userName: null,
                    fullName: null,
                    email: null
                },
                sequence: 0,
                run: {
                    plan: null,
                    job: null,
                    request: null,
                }
            },
            atf: {
                credentials: {
                    oauth: {
                        accessToken: null,
                        refreshToken: null,
                        clientId: null,
                        clientSecret: null
                    }
                },
                updateSetOnly: false
            },
            updateSet: null,
            application: {
                id: null,
                name: null,
                git: {
                    repository: null,
                    remoteUrl: null,
                    enabled: false,
                    pullRequestEnabled: false
                }
            },
            host: {
                name: null,
                credentials: {
                    oauth: {
                        accessToken: null,
                        refreshToken: null,
                        clientId: null,
                        clientSecret: null
                    }
                }
            },
            branch: {
                name: null,
                host: {
                    name: null,
                    credentials: {
                        oauth: {
                            accessToken: null,
                            refreshToken: null,
                            clientId: null,
                            clientSecret: null
                        }
                    }
                },
            },
        }, options);

        console.log(">>> buildUpdateSetOnBranch");

        var step = (message, error) => {    
            return addStep.call(this, config, 'buildUpdateSetOnBranch: '.concat(message), error);
        };

        return Promise.try(() => {
            return this.configure(ctx, 'buildUpdateSetOnBranch');

        }).then((ctx) => {
            /*
            console.log('******************************');
            console.dir(ctx.config, { depth: null, colors: true });
            console.log('******************************');
            */
            if (ctx.config.branch.enabled) {
                // init the remote client
                ctx.config.branch.settings = ctx.config.settings;
                ctx.remote = getClient(ctx.config.branch);

                ctx.source = new SnProject({
                    dir: ctx.config.application.dir.code,
                    appName: ctx.config.application.name,
                    dbName: ctx.config.branch.name,
                    organization: ctx.config.application.organization
                });
            }
            return ctx;
        }).then((ctx) => {
            project = ctx.project;
            client = ctx.client;
            config = ctx.config;
            git = ctx.git;

            return this.build.setProgress(ctx, this.build.IN_PROGRESS);

        }).then(() => {

        
            // only pull from MasterBranch if enabled
            if (!ctx.config.branch.enabled)
                return;
            
            return Promise.try(() => {
                return step(`switch to branch ${ctx.config.branch.name}`);
            
            }).then(() => { // check if already a pull request open
                if (config.application.git.pullRequestEnabled) {
                    console.log("check for pending");
                    return this.pendingPullRequest({
                        ctx: ctx,
                        repoName: config.application.git.repository,
                        from: config.branchName
                    }).then((pending) => {
                        if (pending)
                            throw Error('There is already a pending pull request on this update-set.');
                    });
                }
            }).then(() => { // prepare git 

                if (config.application.git.enabled === true) {
                    return Promise.try(() => {
                        return step(`switch to branch ${ctx.config.branch.name} and clean up all files`);
                    }).then(() => {
                        return git.switchToBranch(ctx.config.branch.name);
                    }).then(() => {
                        return git.fetch('-p');
                    }).then(() => {
                        console.log(`DELETE all files in '${ctx.config.branch.name}'`, path.join(config.application.dir.code, 'sn'));
                        return fs.removeAsync(path.join(config.application.dir.code, 'sn'));
                    });
                }

            }).then(() => { // load all application data from remote. typically from sys_metadata.
                
                return Promise.try(() => {
                    return step(`load all file header (metadata) from ${ctx.config.branch.host.name}`);
                }).then(() => {
                    return this.getApplicationFiles(ctx);
                }).then((files) => {
                    return step(`load all files by class from ${ctx.config.branch.host.name}`).then(() => {
                        return files;
                    });
                }).then((files) => {
                    return processFilesByClass(ctx, files);
                });
                

            }).then(() => { // commit all remote files

                if (config.application.git.enabled === true) {
                    return Promise.try(() => {
                        return step(`GIT commit all (new, modified, deleted) files.`);
                    }).then(() => {
                        return git.add('-A'); // add all. new, modified, deleted
                    }).then(() => {
                        return git.commit({
                            messages: [`${ctx.config.branch.name} branch updated from  ${ctx.config.branch.host.name}`]
                        });
                    }).then(() => {
                        return git.push();
                    });
                }
            });
            
            
        }).then(() => { // build the update set 
            return this.buildUpdateSet(ctx.config, ctx);
       
        }).catch((e) => {
            error = e;
            return Promise.try(() => {
                return this.build.setProgress(ctx, this.build.FAILED);
            }).then(() => {
                return step(`failed`, e);
            }).then(() => {
                throw e;
            });
            
        }).finally(() => {
            return setUpdateSet.call(this, config, 'buildUpdateSetOnBranch', error);
        });
        
    };

    CICD.prototype.buildUpdateSet = function (options, ctx) {
        var client,
            project,
            config,
            git,
            ctx = ctx || {
                config: null,
                client: null,
                project: null
            },
            error;

        ctx.config = config = ObjectAssignDeep({
            build: {
                sequence: 0,
                run: {
                    job: null,
                    request: null,
                }
            },
            atf: {
                credentials: {
                    oauth: {
                        accessToken: null,
                        refreshToken: null,
                        clientId: null,
                        clientSecret: null
                    }
                },
                updateSetOnly: false
            },
            updateSet: null,
            application: {
                id: null,
                name: null,
                git: {
                    repository: null,
                    remoteUrl: null,
                    enabled: false,
                    pullRequestEnabled: false
                }
            },
            host: {
                name: null,
                credentials: {
                    oauth: {
                        accessToken: null,
                        refreshToken: null,
                        clientId: null,
                        clientSecret: null
                    }
                }
            }
        }, options);

        console.log(">>> buildUpdateSet");

        var step = (message, error) => {
            return addStep.call(this, config, 'buildUpdateSet: '.concat(message), error);
        };


        return Promise.try(() => {
            return this.configure(ctx, 'buildUpdateSet');
        }).then((ctx) => {
            project = ctx.project;
            client = ctx.client;
            config = ctx.config;
            
            return this.build.setProgress(ctx, this.build.IN_PROGRESS);

        }).then(() => {
            return this.exportUpdateSet(ctx.config, ctx);

        }).then(() => {
            
            return step('install node application').then(() => {
                return project.install();
            }).then((result) => {
                step('install node application completed', result.log);
            }).catch((error) => {
                step(`install node application failed: \n${error.log}`);
                console.error(error.log);
                throw Error(error.log);
            });
            
        }).then(() => {

            return step('build project').then(() => {
                return project.build();
            }).then((result) => {
                step(`build project completed: \n${result.log}`);
            }).catch((error) => {
                step(`build project failed: \n${error.log}`);
                console.error(error.log);
                throw Error(error.log);

            }).then(() => {
                return Promise.try(() => {
                    if (config.application.git.enabled && config.application.git.pullRequestEnabled) {
                        
                        return Promise.try(() => {
                            return step('raise pull request');
                        }).then(() => {
                            return this.raisePullRequest({
                                ctx: ctx,
                                requestor: config.build.requestor.userName,
                                repoName: config.application.git.repository,
                                from: config.branchName,
                                to: config.branch.name || 'master',
                                title: `${config.build.requestor.fullName} completed '${config.updateSet.name}'. Please review code!`,
                                description: `${config.updateSet.description}\n\nBuild Results: ${ctx.config.application.docUri}\n\nCompleted-By: ${config.build.requestor.fullName} (${config.build.requestor.userName})\nCompleted-On: ${config.updateSet.sys_updated_on} UTC\n${config.host.name}/sys_update_set.do?sys_id=${config.updateSet.sys_id}`
                            });
                        }).then(() => {
                            return this.build.setProgress(ctx, this.build.CODE_REVIEW_PENDING);

                        }).catch((e) => {
                            // master and current branch are the same!
                            //console.log(e);
                            var emptyPullRequest = (e.error.errors || []).some((error) => {
                                return (error.exceptionName == 'com.atlassian.bitbucket.pull.EmptyPullRequestException');
                            });
                            
                            if (emptyPullRequest) {
                                //console.warn(">> empty pull request");
                                return Promise.try(() => {
                                    return step('empty pull request, complete update-set', e);

                                }).then(() => { 
                                    return this.build.setProgress(ctx, this.build.COMPLETE);
                                
                                }).then(() => { 
                                    var slack = getSlack();
                                    return slack.message(`Pull request for '${config.updateSet.name}' ignored as no changes against master branch discovered `);

                                }).then(() => { // deploy the update set
                                    return this.deployUpdateSet(ctx.config, ctx);

                                });
                            
                            } else {
                                // other error, throw...
                                throw e;
                            }
                            
                        });
                        
                    } else {
                        return Promise.try(() => {
                            return step(`complete update-set ${config.updateSet.name}`);
                        }).then(() => {
                            return this.build.setProgress(ctx, this.build.COMPLETE);
                        }).then(() => { // deploy the update set
                            return this.deployUpdateSet(ctx.config, ctx);
                        });
                    }
                });
            }).catch((e) => {
                return this.build.setProgress(ctx, this.build.FAILED).then(() => {
                    throw e;
                });
            });

        }).catch((e) => {
            error = e;
            return Promise.try(() => {
                return this.build.setProgress(ctx, this.build.FAILED);
            }).then(() => {
                return step(`failed`, e);
            }).then(() => {
                throw e;
            });
            
        }).finally(() => {
            return setUpdateSet.call(this, config, 'buildUpdateSet', error);
        });

    };

    CICD.prototype.exportUpdateSet = function (options, ctx) {
        var client,
            activeClient,    
            project,
            config,
            git,
            ctx = ctx || {
                config: null,
                client: null,
                project: null,
                git: null
            },
            error;

        ctx.config = config = ObjectAssignDeep({
            build: {
                sequence: 0,
                run: {
                    job: null,
                    request: null,
                }
            },
            updateSet: null,
            application: {
                id: null,
                name: null,
                git: {
                    repository: null,
                    remoteUrl: null,
                    enabled: false,
                    pullRequestEnabled: false
                }
            },
            host: {
                name: null,
                credentials: {
                    oauth: {
                        accessToken: null,
                        refreshToken: null,
                        clientId: null,
                        clientSecret: null
                    }
                }
            }
        }, options);

        console.log(">>> exportUpdateSet");
        
        var step = (message, error) => {
            return addStep.call(this, config, 'exportUpdateSet: '.concat(message), error);
        };

        return Promise.try(() => {
            return this.configure(ctx, 'exportUpdateSet');

        }).then((ctx) => {
            project = ctx.project;
            client = ctx.client;
            config = ctx.config;
            git = ctx.git;
            
            activeClient = getClient(ctx.config);
            activeClient = new SnRestClient({
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


        }).then(() => {
            return this.build.setProgress(ctx, this.build.IN_PROGRESS);

        }).then(() => { // if git is enables, prepare branch for update-set

            if (config.application.git.enabled === true) {
                return Promise.try(() => {
                    return step(`GIT pull from remote`);
                }).then(() => {
                    return git.pull();
                }).then(() => {
                    return step(`GIT switch to branch ${config.branchName}`);
                }).then(() => {
                    return git.switchToBranch(config.branchName);
                }).then(() => {
                    //return git.reset('master', true);
                }).then(() => {
                    /*
                    return git.pull('--all').catch((e) => { 
                        console.log(e);
                    });
                    */
                }).then(() => { // merge with master
                    return git.merge('master').catch(() => {
                        console.log('merge failed, undo and reset from master');
                        return Promise.try(() => {
                            return step(`GIT merge failed, undo and reset from master.`);
                        }).then(() => {
                            return git.exec({
                                args: 'merge --abort',
                                quiet: false
                            });
                        }).then(() => {
                            console.log("reset SOFT from master");
                            return git.exec({
                                quiet: false,
                                args: 'reset --soft master'
                            });
                        });
                    });
                });
            }

        }).then(() => { // export update-set-xml
            var updatedFiles = [];
            var deletedFiles = [];
            
            return Promise.try(() => {
                return step('export sys_update_xml');

            }).then(() => {    

                return client.get({
                    url: 'api/now/table/sys_update_xml',
                    qs: {
                        'sysparm_query': `update_set.base_update_set=${config.updateSet.sys_id}^ORupdate_set=${config.updateSet.sys_id}^ORDERBYsys_recorded_at`,
                        'sysparm_fields': 'action,name,payload,update_set,sys_id',
                        'sysparm_display_value': false,
                        'sysparm_exclude_reference_link': true,
                        'sysparm_limit': 50
                    }
                }, (results) => {

                    // process page-by-page
                    return Promise.each(results, (result) => {
                        
                        var resultUpdateFiles = [];
                        var resultDeleteFiles = [];

                        return Promise.try(() => { // parse the XML payload
                            return etparse(result.payload);
                        }).then((xmlTree) => { // find all tables, action and sysId in the payload
                            return Promise.each(xmlTree.findall('.//*[@action]'), (element) => {

                                var className = element.tag,
                                    sysId = element.findtext('sys_id');

                                /*
                                    only process payload if the entity is of interest
                                */
                                if (sysId && className && project.hasEntity(className)) {

                                    if ('INSERT_OR_UPDATE' == element.attrib.action) {
                                        // get a list of params used with this entity type
                                        var file = {},
                                            requestArguments = project.getEntityRequestParam(className),
                                            fieldNames = requestArguments.fieldNames,
                                            hasQuery = (requestArguments.queryFieldNames.length);
                                     
                                        // walk through all the fields and copy value if different
                                        return Promise.each(fieldNames, (field) => {
                                            var xmlField = element.find(field.name);
                                            if (xmlField) {
                                                if (xmlField.attrib.display_value) {
                                                    file[field.name] = {
                                                        display_value: xmlField.attrib.display_value,
                                                        value: xmlField.text
                                                    };
                                                } else {
                                                    file[field.name] = xmlField.text;
                                                }
                                            }
                                        }).then(() => {

                                            var updatedByField = file.sys_updated_by || file.sys_created_by;
                                            var updatedBy = (typeof updatedByField == 'object') ? (updatedByField.display_value) ? updatedByField.display_value : updatedByField.value : updatedByField;

                                            file.____ = {
                                                hostName: config.host.name,
                                                className: className,
                                                appName: config.updateSet.appName,
                                                scopeName: config.updateSet.scopeName,
                                                updatedBy: updatedBy,
                                                src: config.branchName
                                            };

                                        }).then(() => {

                                            // some entities do have a query
                                            if (!hasQuery) {
                                                // add the file to the list
                                                resultUpdateFiles.push(file);
                                                return;
                                            }

                                            //console.log('requestArguments.queryFieldNames, ', requestArguments.queryFieldNames);
                                            var hasDotWalk = requestArguments.queryFieldNames.some((name) => {
                                                return (name.indexOf('.') !== -1);
                                            });
                                            var useQueryParser = false;
                                            if (hasDotWalk || !useQueryParser) { // always do this as there is no parser for the XML in place yet.
                                                // query the original record
                                                var entity = project.getEntity(className);
                                                //console.log(`entity ${className} has query ${entity.query}`);

                                                var query = entity.query.split('^NQ').map((segment) => {
                                                    return `sys_id=${sysId}^${segment}`;
                                                }).join('^NQ');

                                                //console.log(`entity ${className} has query ${query} - HOSTNAME ${activeClient.getHostName()}`);

                                                return activeClient.get({
                                                    url: 'api/now/table/'.concat(className),
                                                    qs: {
                                                        sysparm_query: query,
                                                        sysparm_fields: 'sys_id',
                                                        sysparm_limit: 1
                                                    },
                                                    autoPagination: false
                                                }).then((results) => {
                                                    if (results.length) {
                                                        // add the file to the list as the query does match
                                                        resultUpdateFiles.push(file);
                                                    }
                                                });
                                            } else { // take it form the fields
                                                /*
                                                    TODO
                                                    write SNOW query parser
                                                */
                                            }
                                        });

                                    } else if ('DELETE' == element.attrib.action) {
                                        resultDeleteFiles.push(sysId);
                                    }
                                } else {
                                    //console.dir(element, { depth: null, colors: true });
                                }
                            });
                        }).then(() => {

                            var filesDelete = project.remove(resultDeleteFiles).then((files) => {
                                return files.map((delFile) => { // put into the same format
                                    return {
                                        path: delFile
                                    };
                                });
                            });

                            var filesAdded = Promise.try(() => {
                                var filesOnDisk = [];
                                return Promise.each(resultUpdateFiles, (file) => {
                                    return project.save(file).then((filesUpdated) => {
                                        filesOnDisk = filesOnDisk.concat(filesUpdated);
                                    });
                                }).then(() => {
                                    return filesOnDisk;
                                });
                            });

                            return Promise.all([filesDelete, filesAdded]).then((allResults) => {
                                updatedFiles = updatedFiles.concat(allResults[1]);
                                deletedFiles = deletedFiles.concat(allResults[0]);
                            });
                        });
                    });
                }).then(() => {
                   return step(`all files locally created/removed form update-set-xml`);
                        
                }).then(() => {
                    return {
                        updatedFiles: updatedFiles,
                        deletedFiles: deletedFiles
                    };
                });
            });
            
        }).then((files) => {
            return Promise.try(() => {
                return step('configure-project');
            }).then(() => {
                return configureProjectFile(files, ctx).then(() => files);
            });        

        }).then((files) => {
            if (config.application.git.enabled !== true)
                return;

            return Promise.try(() => {
                return step('add files and commit to git');
            }).then(() => {
            
                // delete all old files
                return git.delete(files.deletedFiles.map((file) => file.path));

            }).then(() => {
                // sort updated files update by user
                return getFilesByUpdatedBy(files.updatedFiles);

            }).then((fileByUpdatedBy) => {

                // add and commit per user    
                return Promise.each(Object.keys(fileByUpdatedBy), (updatedBy) => {
                    /*  
                        add all files per User
                    */
                    return Promise.try(() => {
                        return git.add(fileByUpdatedBy[updatedBy]);

                    }).then(() => {
                        return getUser(ctx.client, updatedBy);

                    }).then((user) => {
                        /*  
                        commit all files per User
                        */
                        return git.commit({
                            author: {
                                email: user.email,
                                name: user.name
                            },
                            messages: [`${config.updateSet.name} - Build #${ctx.config.build.sequence}`, config.updateSet.description]
                        });
                    });
                });
            }).then(() => {
                //return git.pull('');
            }).then(() => {
                return git.push();
            });

        }).catch((e) => {
            error = e;
            return Promise.try(() => {
                return this.build.setProgress(ctx, this.build.FAILED);
            }).then(() => {
                return step(`failed`, e);
            }).then(() => {
                throw e;
            });
            
        }).finally(() => {
            return setUpdateSet.call(this, config, 'exportUpdateSet', error);
        });

    };

    CICD.prototype.deployUpdateSet = function (options, _ctx) {

        const MAX_WAIT_SEC = 5 * 60, // time in seconds for the update-set to be completed
              WAIT_DELAY_MS = 1000; // delay in milliseconds for the update-set status to check.

        var client,
            project,
            config,
            ctx = _ctx || {
                config: null,
                client: null,
                project: null,
                git: null
            };

        var slack = getSlack();
        
        ctx.config = config = ObjectAssignDeep({
            // settings : {}
            updateSet: {
                sys_id: null
            },
            host: {
                name: null,
                credentials: {
                    oauth: {
                        accessToken: null
                    }
                }
            },
            build: {
                requestor: {
                    userName: null,
                    fullName: null,
                    email: null
                },
                sequence: 0,
                run: {
                    project: null,
                    job: null,
                    request: null,
                    instance: {
                        _id : ''
                    }
                }
            },
            deploy: {
                host: {
                    name: null,
                    credentials: {
                        oauth: {
                            accessToken: null
                        }
                    },
                    jar : true
                },
            }}, options);

        console.log(">>> deployUpdateSet");
        
        var step = (message, error) => {
            return addStep.call(this, config, 'deployUpdateSet: '.concat(message), error);
        };

        return Promise.try(() => {
            
            /*
                manually configure as the global 'this.configure()' method will cause the project to re-initialize
            */
            ctx.config.settings = ObjectAssignDeep({}, settings);
            ctx.client = client = getClient(ctx.config);

            ctx.config.deploy.settings = ctx.config.settings;
            ctx.target = getClient(ctx.config.deploy);

            project = ctx.project;
            client = ctx.client;
            config = ctx.config;

        }).then(() => {
            if (!(config.deploy && config.deploy.host && ctx.config.deploy.host.name)) {
                return step(`Deploy is disabled for this update-set`);
            }
            
            return Promise.try(() => {
                ctx.config.deploy.settings = ctx.config.settings;
                ctx.target = getClient(ctx.config.deploy);

            }).then(() => { 
                // the US has to be set complete first
                return this.build.setProgress(ctx, this.build.COMPLETE);

            }).then(() => { 
                return slack.message(`Deploying Update-Set <${config.host.name}/sys_update_set.do?sys_id=${config.updateSet.sys_id}|${config.updateSet.name}> from ${ctx.config.host.name} to ${ctx.config.deploy.host.name}`);

            }).then(() => { 
                return step(`deploying updateSet '${config.updateSet.sys_id}'  to '${ctx.config.deploy.host.name}'`);

            }).then(() => { // trigger deploy
                return client.post({ url: 'api/swre/v1/va/deploy' }, { 'updateSetSysId': config.updateSet.sys_id, 'targetEnvironment': ctx.config.deploy.host.name });

            }).then((result) => { // check deploy results 

                result = result[0];
                return step(`UpdateSet successfully transferred. State is '${result.state}', Ready To Commit: '${result.readyToCommit}'`).then(() => {
                    return result;
                });

            }).then((result) => { // check for manual interaction
                var targetHost = result.targetEnvironment;
                var remoteUpdateSetSysId = result.remoteUpdateSetSysId;

                if (!result.readyToCommit) {
                    // needs manual interaction
                    throw {
                        name: 'UpdateSet collision',
                        message: 'To commit this update set you must address all related problems by fixing and previewing again',
                        updateSet: targetHost.concat('sys_remote_update_set.do?sys_id=').concat(remoteUpdateSetSysId)
                    };
                }

                return Promise.try(() => { // Get Commit information
                    return step(`Get Commit information`);
                }).then(() => { 
                    return ctx.target.get({
                        url: 'api/swre/v1/va/commit/'.concat(remoteUpdateSetSysId)
                    });

                }).then((result) => { // Validating Update-Set for Data Loss
                    return step(`Validating Update-Set for Data Loss`).then(() => {
                        return result[0];
                    });
                }).then((result) => {
                    
                    return ctx.target.run({
                        method: result.method,
                        url: result.endpoint,
                        headers: result.headers,
                        form: result.validate,
                        rawResponse: true
                    }).then((validateResult) => {
                        // xml to json
                        var parseStringAsync = Promise.promisify(require('xml2js').parseString);
                        return parseStringAsync(validateResult.body);

                    }).then((resultJson) => {
                        var dataLoss = resultJson.xml.$.answer.split(';')[2];
                        if (dataLoss != 'NONE') {
                            var error = {
                                name: 'Data Loss Warning',
                                message: 'If you commit this update set, the system will automatically delete all data stored in the tables and columns that are defined in these Customer Updates:',
                                updateSet: ctx.config.deploy.name.concat('sys_remote_update_set.do?sys_id=').concat(remoteUpdateSetSysId),
                                warnings: (function () {
                                    return dataLoss.split(',').map((row) => {
                                        var cols = row.split(':');
                                        return {
                                            type: cols[0],
                                            name: cols[1]
                                        };
                                    });
                                }())
                            };
                            throw error;
                        }
                        return result;
                    });

                }).then((result) => { 
                    
                    return step(`Committing update set`).then(() => {
                        return result;
                    }); 
                    
                }).then((result) => { // commit the update set
                    
                    return ctx.target.run({
                        method: result.method,
                        url: '/xmlhttp.do',//result.endpoint,
                        headers: result.headers,
                        form: result.commit,
                        rawResponse: true
                    }).then((commitResult) => {

                        console.log("..done. check for status.");

                        var iter = 0,
                            maxIter = (MAX_WAIT_SEC * 1000 / WAIT_DELAY_MS);

                        return promiseFor((state) => {
                            return (state != 'committed'); // loop as long the us is not committed
                        }, () => {

                            return ctx.target.run({
                                method: 'GET',
                                url: 'api/now/table/sys_remote_update_set/'.concat(remoteUpdateSetSysId)
                            }).then((result) => {
                                iter++;

                                var remoteUpdateSet = result[0],
                                    state = remoteUpdateSet.state;
                                console.log('\tSTATE is: ', state, '#', iter);

                                if (iter >= maxIter) {
                                    throw Error("Commit did not complete in SNOW after " + MAX_WAIT_SEC + " seconds.");
                                } else if (state != 'committed') {
                                    return Promise.delay(WAIT_DELAY_MS).then(() => {
                                        return state;
                                    });
                                } else {
                                    return state;
                                }

                            });
                        }, 0).then(() => {
                            return step(`Update-Set committed after ${iter * WAIT_DELAY_MS / 1000} sec`);
                            }).then(() => {
                                return slack.message(`Update-Set <${config.host.name}/sys_update_set.do?sys_id=${config.updateSet.sys_id}|${config.updateSet.name}> committed on ${ctx.config.deploy.host.name} within ${iter * WAIT_DELAY_MS / 1000} sec`);
                        });
                    });

                }).then((state) => { // status check done
                    return step(`UpdateSet successfully deployed: ${state}`);
                });
            }).catch((e)=>{
                if (!e.updateSet)
                    throw e;
                
                console.error(e);

                return Promise.try(() => {
                    return this.build.setProgress(ctx, this.build.DEPLOYMENT_MANUAL_INTERACTION);

                }).then(() => {
                    return step(`Commit needs manual interaction!`, e);

                }).then(() => {
                    var message = `${e.name}!\n${e.message}. <${e.updateSet}>`;
                    return slack.message(message);
                });    
            });                
        });
    };

    CICD.prototype.gitPullRequestUpdate = function (body) {

        var updateSetId;

        var ctx = {
            config: null,
            client: null,
            project: null
        };

        var slack = getSlack();
        //body.action = 'open';
        return slack.pullRequest.send(body).catch((e) => { // bypass the message to the slack channel
            console.log(e);
        }).then(() => {

            var regex = /^(\S+)-@([a-f0-9]{32})$/gi;
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

        }).then(() => {
            
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
                return this.db.us.find({ updateSetId: updateSetId });
            }).then((us) => {
                if (us.length === 0) {
                    throw Error(`UpdateSet not found with ID ${updateSetId}`);
                }
                return us[0];

            }).then((us) => {
                
                //console.log('job %j', us);
                var config = us.config;
                config.settings = ObjectAssignDeep({}, settings);
                ctx.config = config;
                
                return Promise.try(()=>{
                    if (merge && (config.deploy && config.deploy.host && config.deploy.host.name)) {
                        return this.deployUpdateSet(ctx.config);    
                    }
                }).then(() => {
                    return this.build.setProgress({
                        client: getClient(config),
                        config: config
                    }, ((merge) ? this.build.COMPLETE : this.build.CODE_REVIEW_REJECTED)); 
                });
            });
        });
    };


    CICD.prototype.server = function () {
        
        var express = require('express'),
            bodyParser = require('body-parser'),
            port = settings.server.port;

        var app = express();

        function addRawBody(req, res, buf, encoding) {
            req.rawBody = buf.toString();
        }

        /*

        verify: (req, res, buf, encoding) => {
            req.rawBody = buf.toString();
        }
        */
       
        app.use((req, res, next) => {
            bodyParser.json({
                verify: addRawBody
            })(req, res, (err) => {
                if (err) {
                    console.log(err);
                    res.sendStatus(400);
                    return;
                }
                next();
            });
        });
        
        /*
        app.use(bodyParser.json());
        */
        app.use(bodyParser.urlencoded({ extended: true }));
        
        
        app.use('/', express.static(path.resolve(__dirname, '../' , 'web')));

        app.use('/doc', express.static(path.resolve(settings.documentsRootDir)) );
        
        app.route('/goto/:type/:us').get((req, res) => {
            if ('us' == req.params.type) {
                return this.db.us.get({
                    _id: req.params.us
                }).then((result) => {
                    if (result && result._id && result.app) {
                        if (result.lastSuccessfulRun) {
                            res.redirect(`/steps.html#/app/${result.app}/us/${result._id}/run/${result.lastSuccessfulRun._id}`);
                        } else {
                            res.redirect(`/runs.html#/app/${result.app}/us/${result._id}/`);
                        }
                    } else {
                        res.redirect('/');
                    }
                });
            }
            res.redirect('/');
        });

        app.route('/app').get((req, res) => { 
            return this.db.application.find({}).then((result) => {
                result.sort((a, b) => {
                    if (a.application.name < b.application.name) return -1;
                    if (a.application.name > b.application.name) return 1;
                    return 0;
                });
                res.json(result);
            });
        });
        app.route('/app/:id').get((req, res) => {
            return this.db.application.get({ _id: req.params.id}).then((result) => {
                res.json(result);
            });
        });

        app.route('/app/:id/us').get((req, res) => {
            return this.db.us.find({ app: req.params.id }).then((result) => {
                result = result.map((r) => {
                    if (r.config.host) {
                        delete r.config.host.credentials;
                    }
                    if (r.config.branch) {
                        delete r.config.branch.host.credentials;
                    }
                    if (r.config.deploy) {
                        delete r.config.deploy.host.credentials;
                    }
                    return r;
                });
                res.json(result);
            });
        });

        app.route('/app/:id/us/:us').get((req, res) => {
            return this.db.us.get({ _id: req.params.us }).then((result) => {
                if (result) {
                    if (result.config.host) {
                        delete result.config.host.credentials;
                    }
                    if (result.config.branch) {
                        delete result.config.branch.host.credentials;
                    }
                    if (result.config.deploy) {
                        delete result.config.deploy.host.credentials;
                    }    
                }
                res.json(result);
            });
        });

        app.route('/app/:id/us/:us/run').get((req, res) => {
            return this.db.run.find({ us: req.params.us }).then((result) => {
                result.sort((a, b) => {
                    return (b.ts - a.ts);
                });
                res.json(result);
            });
        });

        app.route('/app/:id/us/:us/run/:run').get((req, res) => {
            return this.db.run.get({ _id: req.params.run }).then((result) => {
                res.json(result);
            });
        });

        app.route('/app/:id/us/:us/run/:run/step').get((req, res) => {
            return this.db.step.find({ run: req.params.run }).then((result) => {
                result.sort((a, b) => {
                    return (b.ts - a.ts);
                });
                res.json(result);
            });
        });

        app.route('/app/:id/us/:us/run/:run/step/:step').get((req, res) => {
            return this.db.step.get({ _id: req.params.step }).then((result) => {
                res.json(result);
            });
        });

        app.route('/us').get((req, res) => {
            return this.db.us.find({}).then((result) => {
                result = result.map((r) => {
                    if (r.config.host) {
                        delete r.config.host.credentials;
                    }
                    if (r.config.branch) {
                        delete r.config.branch.host.credentials;
                    }
                    if (r.config.deploy) {
                        delete r.config.deploy.host.credentials;
                    }
                    return r;
                });
                res.json(result);
            }); 
        });
        app.route('/us/:id').get((req, res) => {
            return this.db.us.get({ _id: req.params.id }).then((result) => {
                if (result) {
                    if (result.config.host) {
                        delete result.config.host.credentials;
                    }
                    if (result.config.branch) {
                        delete result.config.branch.host.credentials;
                    }
                    if (result.config.deploy) {
                        delete result.config.deploy.host.credentials;
                    }
                }
                res.json(result);
            });
        });
        

        app.route('/run').get((req, res) => {
            return this.db.run.find({}).then((result) => {
                result.sort((a, b) => {
                    return (b.ts - a.ts);
                });
                res.json(result);
            });
        });
        app.route('/us/:id').get((req, res) => {
            return this.db.run.get({ _id: req.params.id }).then((result) => {
                res.json(result);
            });
        });

        app.route('/build')
            .post((req, res) => {

                return this.convertBuildBody(req.body).then((options) => {
                    console.log("start CI/CI");
                    console.dir(options, { depth: null, colors: true });
                    // dont return here and wait for the export to be done ...
                    this.buildUpdateSetOnBranch(options);

                    res.json({ job: 'started' });
                });
            });

        app.route('/pull_request')
            .post((req, res) =>{
                
                return this.convertPullBody(req.body).then((body) => { 
                    console.log("pull request inbound");
                    //console.dir(body, { depth: null });
                    
                    try {
                         // dont return here and wait for the deployment to be done ...
                        this.gitPullRequestUpdate(body);
                    } catch (e) {
                        // we want to see the error 
                        console.error(e);
                        throw e;
                    }

                    res.json({ pull: 'received' });
                });
                
            });

        console.log('server started on ', port);
        app.listen(port);

    };

    return CICD;
})();


module.exports = CICD;
