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
const EbQueueJob = require('./eb/queue-job');
const lock = require('./ext/lock');
var inherits = require('util').inherits


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

        self.mutex = lock();
        self.SERVER = 'server';
        self.WORKER = 'worker';

        self.settings = {};
        self.userCache = {};
        self.dataStore = {
            application: null,
            us: null,
            run: null,
            step: null,
            deployment: null,
            test: null
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
                        if (modules[libName]) {
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
                type: (process.env.CICD_DB_MONGO_URL) ? 'mongo' : 'nedb',
                path: (process.env.CICD_INTERNAL_DB_DIR) ? path.resolve(process.env.CICD_INTERNAL_DB_DIR) : path.join(process.cwd(), 'db')
            },
            projectTemplateDir: projectTemplateDir,
            buildConfig: (projectTemplateDir) ? require(path.join(projectTemplateDir, 'build-config.json')) : {
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


        self.once('initializing', (mode) => {
            console.log('initializing :: ', mode)
        });
        self.once('initialized', (mode) => {
            console.log('initialized :: ', mode)
        })

        self.once('server-started', (port) => {
            console.log('server-started :: ', port)
        })
        self.once('worker-started', (socketId) => {
            console.log('worker-started :: ', socketId)
        })

        return {
            start: () => {
                return self.start();
            },
            worker: () => {
                return self.worker();
            }
        };
    };


    //CICD.prototype = new CICDInt();
    inherits(CICD, CICDInt);

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
        self.emit('initializing', mode);

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
            }).then(() => {
                self.emit('initialized', mode);
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
        }).then(() => {
            /*
                Configure DB 
            */
            self.db = require('./prototype/load-dao').call(self);
            console.log('INIT\t', 'db-type', self.db.type);

        }).then(() => {

            return require('./prototype/mongo-migrate').call(self);

        }).then(() => {
            /*
                reset all update-set running flag
            */
            console.log('INIT\t', 'reset all us.running flags');
            return self.db.us.find({ running: true }).then((result) => {
                return Promise.each(result, (us) => {
                    us.running = false;
                    return self.db.us.update(us);
                });
            });
        }).then(() => {
            /*
                reset the self.db.run flags to eg 'failed' if was 'running'
            */
            console.log('INIT\t', 'reset all run.state & run.running flags');
            return self.db.run.find({ $or: [{ running: true }, { state: null }] }).then((result) => {
                return Promise.each(result, (run) => {
                    run.running = false;
                    run.state = run.state || 'failed';
                    return self.db.run.update(run);
                });
            });
        }).then(() => {
            /*
                reset 'requested' state for test 
            */
            console.log('INIT\t', 'reset all test.state flags');
            return self.db.test.find({ state: 'requested' }).then((result) => {
                return Promise.each(result, (test) => {
                    test.state = 'canceled';
                    return self.db.test.update(test);
                });
            });
        }).then(() => {
            /*
                reset 'requested' state for deployment
            */
            console.log('INIT\t', `reset 'requested' state for deployment to 'canceled'`);
            return self.db.deployment.find({ state: 'requested' }).then((result) => {
                return Promise.each(result, (deployment) => {
                    deployment.state = 'canceled';
                    return self.db.deployment.update(deployment);
                });
            });
        }).then(() => {
            // schema has changed, update NeDB to use 'onHost' instead of 'on'
            if ('nedb' != self.settings.dataStore.type)
                return;

            /*
                migrate 'lastSuccessfulRun' to id
            */
            return Promise.try(() => {
                return self.db.us.find({ 'lastSuccessfulRun._id': { $exists: true } }).then((result) => {
                    if (result.length)
                        console.log('INIT\t', 'migrate field us.lastSuccessfulRun._id to us.lastSuccessfulRunId');

                    return Promise.each(result, (us) => {
                        us.lastSuccessfulRunId = us.lastSuccessfulRun._id;
                        delete us.lastSuccessfulRun;
                        return self.db.us.update(us);
                    });
                });
            }).then(() => {
                console.log('INIT\t', 'migrate run.mergedDeployment & run.forcedDeployment');
                return self.db.run.find({ 'config.mergedDeployment': { $exists: false } }).then((result) => {
                    return Promise.each(result, (run) => {
                        run.config.mergedDeployment = run.config.application.mergedDeployment;
                        run.config.forcedDeployment = run.config.application.forcedDeployment;
                        return self.db.run.update(run);
                    });
                });
            }).then(() => {
                return self.db.test.find({ on: { $exists: true } }).then((result) => {
                    if (result.length)
                        console.log('INIT\t', 'migrate field test.on to test.onHost');

                    return Promise.each(result, (test) => {
                        test.onHost = test.on;
                        delete test.on;
                        return self.db.test.update(test);
                    });
                })
            }).then(async () => {
                const projectsDir = path.join(self.settings.dataStore.path, 'projects');
                if (! await fs.exists(projectsDir))
                    return;

                const Datastore = require('nedb');
                const projectFiles = await fs.readdir(projectsDir);

                return Promise.each(projectFiles, async (file) => {
                    const fArr = file.split(".");
                    const isDb = (fArr.length > 0 && fArr[1] === 'db');
                    if (!isDb)
                        return;

                    const name = fArr[0];


                    const fullPath = path.join(self.settings.dataStore.path, 'projects', `${name}.db`);
                    let coll = new Datastore({
                        filename: fullPath,
                        autoload: true
                    });
                    Promise.promisifyAll(coll);

                    return coll.findAsync({ sysId: { $exists: false } }).then((projectList) => {
                        if (projectList.length == 0)
                            return;

                        console.log('INIT\t', 'migrating filesystem of project', name, fullPath);

                        return Promise.each(projectList, (project) => {
                            return coll.updateAsync({ _id: project._id }, { $set: { sysId: project._id } });
                        }).then(() => {
                            console.log('INIT\t', `${projectList.length} project records migrated.`)
                        })
                    })
                });
            });

        }).then(() => {
            self.emit('initialized', mode);
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
            active: Boolean(process.env.CICD_SLACK_ENABLED === 'true'),
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
            gitignore: ['/config/', '/docs*/'],
            remoteUrl: config.git.remoteUrl,
            quiet: true,
            user: {
                name: process.env.CICD_GIT_USER_NAME || null,
                email: process.env.CICD_GIT_USER_EMAIL || null,
                password: process.env.CICD_GIT_USER_PASSWORD || null,
                store: (process.env.CICD_GIT_USE_CRED_STORE == 'true') ? true : false
            }
        });
    };

    /**
     * Representation of ServiceNow XML files as NodeJs project
     * 
     * @param {*} config the config object
     * @returns {SnProject} 
     */
    CICD.prototype.getProject = function (config, branch) {
        const self = this;
        if (!config)
            return null;

        return self.db.registerDataStore(config.build.applicationId).then(() => {
            return new SnProject({
                dir: config.application.dir.code,
                appName: config.application.name,
                dbName: config.master.name,
                organization: config.application.organization,
                includeUnknownEntities: config.application.includeUnknownEntities,
                allEntitiesAsJson: config.application.allEntitiesAsJson,
                templateDir: self.settings.projectTemplateDir,
                templates: self.settings.buildConfig.files,
                branch,
                sysFieldWhiteList: config.application.sysFieldWhiteList
            }, self.db[config.build.applicationId]);
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

        const subDomain = self.getSubdomain(config.host.name, false)
        const varName = `CICD_CI${((subDomain) ? `_${subDomain.toUpperCase()}` : '')}_USER`;

        const username = process.env[`${varName}_NAME`] || process.env.CICD_CI_USER_NAME;
        const password = process.env[`${varName}_PASSWORD`] || process.env.CICD_CI_USER_PASSWORD;

        return new self.SnClient({
            hostName: config.host.name,
            proxy: self.settings.proxy,

            username: username,
            password: password,

            appPrefix: process.env.CICD_APP_PREFIX || undefined,

            debug: false,
            silent: true,
            jar: config.host.jar || false
        });
    };


    CICD.prototype.getCdCredentials = function (hostFQDN) {
        const varName = `${((hostFQDN) ? `_${hostFQDN.toUpperCase()}` : '')}_USER`;
        const cdUsername = process.env[`CICD_CD${varName}_NAME`] || process.env.CICD_CD_USER_NAME || process.env[`CICD_CI${varName}_NAME`] || process.env.CICD_CI_USER_NAME;
        const cdPassword = process.env[`CICD_CD${varName}_PASSWORD`] || process.env.CICD_CD_USER_PASSWORD || process.env[`CICD_CI${varName}_PASSWORD`] || process.env.CICD_CI_USER_PASSWORD;
        return {
            username: cdUsername,
            password: cdPassword
        }
    };


    /**
     * Get a ServiceNow rest response value
     * @param {*} element name of the element
     * @returns {*} value of the element
     */
    CICD.prototype.getValue = function (element) {
        if (element === undefined || element === null)
            return element;
        return (element.value !== undefined) ? (typeof element.value == 'string') ? element.value.trim() : element.value : element;
    };

    /**
     * Get a ServiceNow rest response display-value
     * @param {*} element name of the element
     * @returns {*} display-value of the element, value fallback
     */
    CICD.prototype.getDisplayValue = function (element) {
        const self = this;
        if (element === undefined || element === null)
            return element;
        return (element.display_value !== undefined) ? (typeof element.display_value == 'string') ? element.display_value.trim() : element.display_value : self.getValue(element);
    };

    /**
     * Set the state field of the current run
     * 
     * @param {Object} config the config object OR a run object
     * @param {State} state the state text
     * @returns {Promise} 
     */
    CICD.prototype.setRunState = function (obj, state) {
        const self = this;

        if (obj && obj._id) { // in this case its a run object
            const run = obj;
            return self.addStep(console, run.config, `Change Run State to '${state}'`).then(() => {
                run.state = state;
                return self.db.run.update(run);
            });
        }

        if (!(obj && obj.build && obj.build.runId)) {
            return self.addStep(console, obj, `ERROR: Change Run State - invalid config object '${obj}'`);
        }
        const runId = obj.build.runId;
        return self.db.run.get(runId).then((run) => {
            if (!run)
                return self.addStep(console, obj, `WARN: Change Run State - no run record found with id '${runId}'`);


            return self.addStep(console, obj, `Change Run State to '${state}'`).then(() => {
                run.state = state;
                return self.db.run.update(run);
            });
        }).catch((e) => {
            console.error('CICD.prototype.setRunState', e);
        });
    };

    CICD.prototype.link = function (host, url) {
        return host.replace(/\/$/m, '').concat('/nav_to.do?uri=', encodeURIComponent(url.replace(/^\//m, '')));
    }

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
            if (error)
                return self.addStep(console, config, 'finalizeRun-error', error);
        }).then(() => {
            if (error)
                return self.setRunState(config, self.run.ERROR);
        }).then(() => {
            if (!(config && config.build && config.build.runId))
                return;

            return Promise.try(() => {
                return self.db.run.get(config.build.runId);
            }).then((run) => {
                if (!run.state)
                    return self.setRunState(run, self.run.UNDEFINED);

                return run;
            }).then((run) => {

                run.running = false;
                return self.db.run.update(run);

            }).then((run) => {

                return self.db.us.get(run.usId);
            }).then((us) => {
                /*
                if (run.state != 'error')
                    us.lastSuccessfulRunId = run._id;
                */

                us.running = false;
                return self.db.us.update(us);

            });

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
            if (error) {

                //console.log("-------------- addStep ERROR", error, error.message, error.toString());
                step.error = error.message || error;
                logger.error(step.state, step.error || '', error);
            } else {
                logger.log(step.state);
            }

            return self.db.step.insert(step).then(() => null);
        }).catch((e) => {
            logger.error('CICD.prototype.addStep', e);
        });
    };

    /**
     * Send notifications via Email.
     * @param {*} recipient comma separated list of email addresses
     * @param {String} subject
     * @param {String} message the message in HTML format
     */
    CICD.prototype.email = {
        getTransporter: function () {
            const nodemailer = require('nodemailer');

            const options = {
                host: process.env.CICD_EMAIL_HOST,
                port: process.env.CICD_EMAIL_PORT,
                secure: Boolean(process.env.CICD_EMAIL_SECURE === 'true')
            };

            if (process.env.CICD_EMAIL_USER_NAME) {
                options.auth = {
                    user: process.env.CICD_EMAIL_USER_NAME,
                    pass: process.env.CICD_EMAIL_USER_PASSWORD
                }
            }

            return nodemailer.createTransport(options);
        },

        text: function (recipient, subject, message) {
            return Promise.try(() => {
                if (process.env.CICD_EMAIL_ENABLED !== 'true') {
                    console.warn('Email notification is disabled. Following message was not sent:', recipient, subject, message)
                    return;
                }
                return this.getTransporter().sendMail({
                    from: process.env.CICD_EMAIL_FROM,
                    to: recipient,
                    subject: subject,
                    html: message
                }).catch((e) => {
                    console.error('Email notification error:', e);
                });
            });
        },


        onBuildFailure: function ({ recipient, subject, data: { sequence, sourceUpdateSetName, sourceUpdateSetID, sourceUpdateSetUrl, docUri } }) {

            subject = subject || `[CICD Build Warning] : Build for '${sourceUpdateSetName} › #${sequence}' failed`;
            const message = `<h2><font color="red">Build failed</font></h2>
                        <p>The build of update set <a href="${sourceUpdateSetUrl}">${sourceUpdateSetName}</a> failed.</p>
                        <p>
                        Build results can be found <a href="${docUri}">here</a>
                        </p>`;

            return this.text(recipient, subject, message);
        },

        onPreviewConflicts: function ({ recipient, subject, data: { sequence, sourceHostName, sourceUpdateSetName, sourceUpdateSetID, sourceUpdateSetUrl, targetHostName, remoteUpdateSetID, remoteUpdateSetUrl, previewProblems, dataLossWarnings } }) {

            subject = subject || `PREFLIGHT CONFLICTS - Update Set is causing conflicts : Preview of '${sourceUpdateSetName} › #${sequence}' requires manual interaction`;
            const lead = `<h2><font color="orange">Preview of '${sourceUpdateSetName} › #${sequence}' requires manual interaction.</font></h2>
                <p>The <b>'conflict detection'</b> step on target ${targetHostName} failed and requires to be resolved manually.</p>
                <p><b>Please open the <a href="${remoteUpdateSetUrl}">Preview Update Set</a> and resolve all conflicts to proceed with this CICD run.</b></p>`;

            return this.onDeploymentConflicts({ recipient, subject, data: { sequence, sourceHostName, sourceUpdateSetName, sourceUpdateSetID, sourceUpdateSetUrl, targetHostName, remoteUpdateSetID, remoteUpdateSetUrl, previewProblems, dataLossWarnings } }, lead);

        },

        onPreviewFailure: function ({ recipient, subject, data: { sequence, errorName, errorMessage, sourceHostName, sourceUpdateSetName, sourceUpdateSetID, sourceUpdateSetUrl, targetHostName } }) {

            subject = subject || `[CICD Conflict Detection Error] : Preview of '${sourceUpdateSetName} › #${sequence}' failed`;
            const lead = `<h2><font color="red">Conflicts in Update Set '${sourceUpdateSetName}'</font></h2>
            <p>The <b>'conflict detection'</b> step on target ${targetHostName} failed!</p>`;

            return this.onDeploymentFailure({ recipient, subject, data: { sequence, errorName, errorMessage, sourceHostName, sourceUpdateSetName, sourceUpdateSetID, sourceUpdateSetUrl, targetHostName } }, lead);
        },


        onDeploymentConflicts: function ({ recipient, subject, data: { sequence, sourceHostName, sourceUpdateSetName, sourceUpdateSetID, sourceUpdateSetUrl, targetHostName, remoteUpdateSetID, remoteUpdateSetUrl, previewProblems, dataLossWarnings } }, lead) {

            subject = subject || `DEPLOYMENT CONFLICTS - Update Set is causing conflicts: Deployment of '${sourceUpdateSetName} › #${sequence}' requires manual interaction`;
            let message = lead || `<h2><font color="red">Deployment Conflicts in Update Set '${sourceUpdateSetName} › #${sequence}'</font></h2>
                <p>The <b>'preview'</b> step during the update set deployment on target ${targetHostName} detected conflicts and requires them to be resolved manually.</p>
                <p><b>Please open the <a href="${remoteUpdateSetUrl}">Target Update Set</a> and resolve all conflicts to proceed with this deployment.</b></p>`;

            message += `
                <p>
                    <table>
                        <tr>
                            <td>Source:</td>
                            <td>${sourceHostName}</td>
                        </tr>
                        <tr>
                            <td>Update Set:</td>
                            <td><a href="${sourceUpdateSetUrl}">${sourceUpdateSetName}</a></td>
                        </tr>
                        <tr>
                            <td>Target:</td>
                            <td>${targetHostName}</td>
                        </tr>
                        <tr>
                            <td>Update Set:</td>
                            <td><a href="${remoteUpdateSetUrl}">${remoteUpdateSetUrl}</a></td>
                        </tr>
                    </table>
                </p>
                `;

            if (previewProblems.length) {
                message += ['<h3>Update conflict:</h3>', '<p><table border="1" cellspacing="0" cellpadding="4">', '<tr><th>Type</th><th>Description</th><th>Link</th></tr>'].concat(previewProblems.map((warning) => {
                    return `<tr><td>${warning.type.toUpperCase()}</td><td>${warning.name}</td><td><a href="${warning.link}">open</a></td></tr>`;
                }), '</table></p>').join('');
            }

            if (dataLossWarnings.length) {
                message += ['<h3>Data Loss Warnings:</h3>', '<p><table border="1" cellspacing="0" cellpadding="4">', '<tr><th>Type</th><th>Description</th><th>Link</th></tr>'].concat(dataLossWarnings.map((warning) => {
                    return `<tr><td>${warning.type.toUpperCase()}</td><td>${warning.name}</td><td><a href="${warning.link}">open</a></td></tr>`;
                }), '</table></p>').join('');
            }

            return this.text([recipient].concat((process.env.CICD_EMAIL_ADMINS || '').split(',')).join(','), subject, message);
        },

        onDeploymentHasMissingRecords: function ({ recipient, subject, data: { sequence, sourceHostName, sourceUpdateSetName, sourceUpdateSetID, sourceUpdateSetUrl, targetHostName, remoteUpdateSetID, remoteUpdateSetUrl, missingRecords } }) {

            subject = subject || `DEPLOYMENT - Completed with missing references! Deployment of '${sourceUpdateSetName} › #${sequence}' requires manual interaction`;

            const lead = `<h2><font color="red">Completed with missing references in Update Set '${sourceUpdateSetName} › #${sequence}'</font></h2>
                <p><b>Please open the <a href="${remoteUpdateSetUrl}">Target Update Set</a> and resolve missing records to successfully complete this deployment.</b></p>`;

            const errorName = 'Completed with missing references';
            const errorMessage = '<b>Deployment requires manual actions due to missing references in following changes</b> <ul>'.concat(Object.keys(missingRecords).map((updateName) => {
                return `<li><a href="${missingRecords[updateName].link}">${updateName}</a> ${missingRecords[updateName].description}</li>`;
            }).join(''), '</ul>');

            return this.onDeploymentFailure({ recipient, subject, data: { sequence, errorName, errorMessage, sourceHostName, sourceUpdateSetName, sourceUpdateSetID, sourceUpdateSetUrl, targetHostName } }, lead);
        },

        onDeploymentFailure: function ({ recipient, subject, data: { sequence, errorName, errorMessage, sourceHostName, sourceUpdateSetName, sourceUpdateSetID, sourceUpdateSetUrl, targetHostName } }, lead) {

            subject = subject || `[CICD Deployment Error] : Deployment of '${sourceUpdateSetName} › #${sequence}' failed`;
            let message = lead || `<h2><font color="red">The update set deployment on target ${targetHostName} failed!</font></h2>`;

            message += `
                <p>Error: ${errorMessage}</p>
                <p>
                    Source: ${sourceHostName}<br>
                    Update Set: <a href="${sourceUpdateSetUrl}">${sourceUpdateSetName}</a><br>

                    Target: ${targetHostName}<br>
                </p>`;


            return this.text([recipient].concat((process.env.CICD_EMAIL_ADMINS || '').split(',')).join(','), subject, message);
        }
    };

    /**
     * Add additional information about the update-set form ServiceNow to the config object
     * 
     * @param {*} config the config object
     * @returns {Promise}
     */
    CICD.prototype.getUpdateSetDetails = async function (config) {
        const self = this;

        const client = self.getClient(config);
        // turn the sysId (config.updateSet) into the UpdateSet Object
        config.updateSet = await client.getUpdateSetDetails(config.updateSet);
        return config;
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

            const defaultUser = {
                sysId: undefined,
                name: process.env.CICD_GIT_USER_NAME,
                email: process.env.CICD_GIT_USER_EMAIL
            };

            if (!userId || !client)
                return defaultUser;

            return client.getUserById(userId).then((result) => {
                if (!result.length)
                    return defaultUser;

                const sysUser = result[0];
                if (!sysUser.name || !sysUser.email)
                    return defaultUser;
                user = {
                    sysId: sysUser.sys_id,
                    name: sysUser.name,
                    email: sysUser.email
                };
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

        return Promise.try(() => {
            if (!client)
                return self.addStep(console, config, `ERROR: Change Update Set status - invalid config object '${config}'`);

            return Promise.try(() => {
                if (config.build && config.build.runId) {
                    return self.db.run.get(config.build.runId).then((run) => {
                        run.updateSetState = state;
                        return self.db.run.update(run);
                    });
                }
            }).then(() => {
                return self.addStep(console, config, `Change Update Set status to '${state}'`);
            }).then(() => {
                const updateSetId = config.updateSet.sys_id || config.updateSet;
                return client.setUpdateSetStatus(updateSetId, state);
            });
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

        const sysMeta = remote.getFilesFromTable({
            tableName: 'sys_metadata',
            options: {
                qs: {
                    sysparm_query: `sys_scope=${config.application.id}`,
                    sysparm_fields: 'sys_id, sys_class_name'
                }
            }
        });

        const sysScope = remote.getFilesFromTable({
            tableName: 'sys_scope',
            options: {
                qs: {
                    sysparm_query: `sys_id=${config.application.id}`,
                    sysparm_fields: 'sys_id, sys_class_name'
                }
            }
        });

        return Promise.all([sysMeta, sysScope]).then((results) => {
            return [].concat(results[0], results[1]);
        })
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
            tableName: 'sys_atf_test_suite',
            options: {
                qs: {
                    sysparm_query: `active=true^sys_scope=${config.application.id}`,
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
            tableName: 'sys_atf_test',
            options: {
                qs: {
                    sysparm_query: `active=true^sys_scope=${config.application.id}`,
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
     * Get all ATF test cases to which the passed test-step id's belong to
     * 
     * @param {*} config 
     * @param {Array} testStepSysIds the testSteps sys_ids to look up
     */
    CICD.prototype.getTestsFromTestStep = function (config, testStepSysIds) {
        const self = this;
        return Promise.try(() => {
            if (!testStepSysIds)
                return [];

            const client = self.getClient(config);
            const sysIds = Array.isArray(testStepSysIds) ? testStepSysIds : [testStepSysIds];

            if (sysIds.length === 0)
                return [];


            const arrayChunks = (array, chunkSize) => Array(Math.ceil(array.length / chunkSize)).fill().map((_, index) => index * chunkSize).map((begin) => array.slice(begin, begin + chunkSize));
            const chunks = arrayChunks(sysIds, 25);

            if (chunks.length > 1)
                console.log(`getTestsFromTestStep : split query into ${chunks.length} chunks`);

            return Promise.mapSeries(chunks, (chunk, index) => {
                if (chunks.length > 1)
                    console.log(`\tchunk ${index + 1} with ${chunk.length} sys_id's`);

                const param = {
                    tableName: 'sys_atf_step',
                    options: {
                        qs: {
                            sysparm_query: `test.active=true^active=true^sys_idIN${chunk.join(',')}`,
                            sysparm_fields: 'sys_id, test'
                        }
                    }
                };
                return client.getFilesFromTable(param).map(function (atfStep) {
                    return {
                        className: 'sys_atf_test',
                        sysId: atfStep.test
                    }
                });
            }).then((filesPerChunks) => {
                return filesPerChunks.flat(1);
            });
        })
    };


    /**
     * Group the filesOnDisk array by updatedBy (user)
     * 
     * @param {Array} filesOnDisk 
     * @returns {Promise<Object>}
     */
    CICD.prototype.getFilesByUpdatedBy = function (filesOnDisk) {
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
     * @returns {Promise<Array>} [{_id, sysId, path, updatedBy, modified}]
     */
    CICD.prototype.processFilesByClass = function (config, applicationFiles) {
        const self = this;

        const remote = self.getClient(config.master);
        let project;

        applicationFiles = applicationFiles || [];
        return self.getProject(config, config.master.name).then((_project) => {
            project = _project;
        }).then(() => {
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

            }, {});
        }).then(async (applicationFilesByClass) => {

            const arrayChunks = (array, chunkSize) => Array(Math.ceil(array.length / chunkSize)).fill().map((_, index) => index * chunkSize).map((begin) => array.slice(begin, begin + chunkSize));
            let filesOnDisk = [];

            // callback per chunk
            await Promise.map(Object.keys(applicationFilesByClass), async (className) => {

                const allFilesByClass = applicationFilesByClass[className];
                const chunks = arrayChunks(allFilesByClass, 25);

                console.log(`\t${className} (${allFilesByClass.length} records in ${chunks.length} chunks)`);

                // split in blocks of 25 files to reduce the URL length later in processFiles()
                await Promise.map(chunks, async (files) => {
                    const filesUpdated = await self.processFiles({ remote, project, config }, className, files);
                    filesOnDisk = filesOnDisk.concat(filesUpdated);
                }, { concurrency: 5 });

            }, { concurrency: 5 });

            return filesOnDisk;

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
    CICD.prototype.processFiles = function ({ remote, project, config }, className, applicationFiles) {
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

            /* 
             configure the request parameter */
            const requestParam = {
                tableName: entityRequestParam.className,
                options: {
                    qs: {
                        sysparm_query: query,
                        sysparm_display_value: 'all',
                        sysparm_add_dependents: 'true',
                        active: true,
                        sysparm_fields: entityRequestParam.fieldNames.map((field) => field.name).join(',') || null
                    }
                }
            };

            if (project.loadJson()) {
                return remote.getFilesFromTable({
                    tableName: entityRequestParam.className,
                    options: {
                        qs: {
                            sysparm_exclude_reference_link: true,
                            sysparm_limit: 1
                        },
                        autoPagination: false
                    }
                }).then((results) => {
                    if (results && results.length) {
                        requestParam.options.qs.sysparm_fields = [...new Set([].concat(entityRequestParam.fieldNames.map((field) => field.name)).concat(Object.keys(results[0])))].join(',')
                    }
                }).then(() => requestParam);

            } else {
                return requestParam;
            }

        }).then((requestParam) => {
            let filesOnDisk = [];
            return remote.getFilesFromTable(requestParam, (files) => {
                // parse and save file to disk
                return Promise.each(files, (file) => {
                    const dependents = (file.__dependents && file.__dependents.length) ? file.__dependents : [];

                    Object.keys(file).forEach((key) => {
                        if (key.startsWith('__'))
                            delete file[key];
                    });

                    return self.processFile({ remote, project, config }, file, className).then((filesUpdated) => {
                        filesOnDisk = filesOnDisk.concat(filesUpdated);
                    }).then(() => {

                        return Promise.each(dependents, (dependent) => {
                            const dependentClassName = dependent.__className;

                            dependent['sys_scope.name'] = dependent['sys_scope.name'] || file['sys_scope.name'];
                            dependent['sys_scope.scope'] = dependent['sys_scope.scope'] || file['sys_scope.scope'];

                            Object.keys(dependent).forEach((key) => {
                                if (key.startsWith('__'))
                                    delete dependent[key];
                            });
                            return self.processFile({ remote, project, config }, dependent, dependentClassName).then((filesUpdated) => {
                                filesOnDisk = filesOnDisk.concat(filesUpdated);
                            });
                        });

                    });

                });

            }).then(() => {
                return filesOnDisk;
            });
        });

    };


    CICD.prototype.processFile = function ({ remote, project, config }, file, className) {
        const self = this;

        if (config.application.nullForEmpty) {
            // convert empty string to null
            Object.keys(file).forEach((key) => {

                const field = file[key];
                if (field.value !== undefined) {
                    const value = field.value;
                    field.value = (typeof value == 'string' && value.length === 0) ? null : value;
                }
                if (field.display_value !== undefined) {
                    const value = field.display_value;
                    field.display_value = (typeof value == 'string' && value.length === 0) ? null : value;
                }
            });
        }

        /*
            TODO:
            - check if the file in the fileList has an update_on value older than the real one.
              this indicates that the record was modified in the default update set.

        */
        let appName = self.getDisplayValue(file['sys_scope.name']) || 'Global';
        let scopeName = self.getDisplayValue(file['sys_scope.scope']) || 'global';
        const updatedBy = self.getDisplayValue(file.sys_updated_by) || self.getDisplayValue(file.sys_created_by) || 'system';

        // assign scope / app files to its own scope
        if (['sys_scope', 'sys_app', 'sys_store_app'].includes(className)) {
            appName = self.getDisplayValue(file.name);
            scopeName = self.getDisplayValue(file.scope)
        }

        file = project.appendMeta(file, {
            hostName: remote.getHostName(), // getHostName()
            className: className,
            appName: appName,
            scopeName: scopeName,
            updatedBy: updatedBy
        });


        return project.save(file).then((filesUpdated) => {
            return filesUpdated;
        }).catch((e) => {
            console.error('SnProject.prototype.save failed');
            console.dir(file, { depth: null, colors: true });
            console.error('------------------------------');
            throw e;
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
                console.error(e);
            }).then(() => body);

        }).then((body) => {
            return new EventBusJob({ name: 'pullRequestEvent', background: true }, { body }).then(() => {
                return { status: 'received' };
            });
        });
    };

    /**
     * Delete Branch from DB and remove
     * 
     * @param {*} config 
     * @param {*} branchName
     * @returns {Promise<void>}
     */
    CICD.prototype.deleteBranch = function (config, branchName) {
        const self = this;

        const step = (message, error) => {
            return self.addStep(console, config, `${path.basename(__filename).split('.')[0]}.deleteBranch : ${message}`, error);
        };

        if (!config || !branchName || config.git.deleteBranchOnMerge !== true)
            return Promise.try(() => {
                if (config.git.deleteBranchOnMerge !== true)
                    return step(`CICD_GIT_DELETE_BRANCH_ON_MERGE not activated, skip deletion of branch '${branchName}'`);
            });

        return Promise.try(() => {
            return step(`Delete branch '${branchName}' from files database`);
        }).then(() => {
            // get project and git
            return self.getProject(config, branchName).then((project) => ({ project, git: self.getGit(config) }));
        }).then(({ git, project }) => {

            return Promise.try(() => {
                return step(`Delete files from database`);
            }).then(() => {
                return project.deleteBranch(branchName);
            }).then(() => {
                return step(`Delete branch on origin`);
            }).then(() => {
                return git.deleteBranchRemote(branchName);
            }).catch((e) => {
                return step(`Deleting ${branchName} failed`, e);
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

    /**
     * get the sub domain from the host
     * 
     * @param {*} host 
     * @param {*} fallback if the regex does not match return this as fallback - in stead of the host parameter
     */
    CICD.prototype.getSubdomain = function (host, fallback) {
        if (!host)
            return fallback !== undefined ? fallback : host;

        const m = host.match(/(?:http[s]?:\/\/)([^\.]*)([^:\/]*)/i);
        // fallback to full source host name
        return (m) ? m[1] : fallback !== undefined ? fallback : host;
    };

    return CICD;
})();

module.exports = CICD;
