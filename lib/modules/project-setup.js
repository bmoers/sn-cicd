/* eslint-disable complexity */
const assign = require('object-assign-deep');
const path = require("path");
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require("fs-extra"));
const url = require('url');
const get = require('../get');
const { v4: uuidv4 } = require('uuid');
const fillTemplate = require('es6-dynamic-template');

const HouseKeepingJob = require('../eb/housekeeping');
/**
 * Initial run setup
 *
 * @param {Object} options job definition
 * @param {Console} logger a logger to be used
 * @param {Object} job job object 
 * @returns {Promise}
 */
module.exports = function (options = {}, logger = console, { host }) {
    const self = this;
    //console.log('project-setup exports');
    //console.log('%j', options);

    const houseKeeping = function (app) {
        const self = this;
        var maxRun = 5;

        console.log('*** house keeping ***');
        return Promise.try(() => {
            return self.db.us.find({
                appId: app._id
            });
        }).then((usList) => {
            console.log('check all update-set to be deleted. total #', (usList || []).length);

            return Promise.each(usList || [], (us) => {

                return Promise.try(() => {
                    return self.db.run.find({
                        usId: us._id
                    });
                }).then((runList) => {

                    console.log(`us: ${us._id} previous runs # ${runList.length}`);

                    // isolate the old ones
                    var sortedRun = runList.sort((a, b) => {
                        return b.ts - a.ts;
                    });
                    var length = -1 * (sortedRun.length - maxRun);
                    if (length < 0) {
                        console.log(`\tto be deleted # ${length * -1}`);
                        var removeRun = sortedRun.slice(length);

                        return Promise.each(removeRun || [], (run) => {
                            // find and delete steps for the runs to be deleted
                            console.log(`\tremove all steps of run ${run._id}`);
                            return self.db.step.find({
                                runId: run._id
                            }).then((stepList) => {
                                return Promise.each(stepList || [], (step) => {
                                    return self.db.step.delete(step);
                                });
                            }).then(() => {
                                if (!run.dir)
                                    return;

                                console.log(`\tdelete the run # ${run._id}`);
                                //return self.db.run.delete(run);

                                return Promise.try(() => {
                                    if (run.dir.doc) {
                                        console.log(`\t\tdelete all files in '${run.dir.doc}'`);
                                        return fs.removeAsync(run.dir.doc);
                                    }
                                }).then(() => {
                                    if (run.dir.code && run.buildOnHost) { //  && run.buildOnHost != host
                                        console.log(`\t\trequest ${host} to delete all files in '${run.dir.code}'`);
                                        return new HouseKeepingJob({ codeDir: run.dir.code }, host);
                                    }
                                }).catch((e) => {
                                    // ignore as it will run again later
                                    console.error("Housekeeping failed on ", e);
                                    //throw e;
                                });
                            }).then(() => {
                                return self.db.run.delete(run);
                            });
                        });
                    }
                });
            });

        });
    };

    const getApplication = function (app) {
        const self = this;
        /*
        var app = assign(application, {
            _id: application.id,
        });
        */

        return self.db.application.findOne({
            id: app.id
        }).then((result) => {
            return Promise.try(() => {
                if (!result) {
                    return self.db.application.insert(app).then((result) => {
                        app = result;
                    });
                } else {
                    return Promise.try(() => {
                        // in case the application info change
                        app._id = result._id;
                        return self.db.application.update(app).then(() => {
                            app = result;
                        });
                    }).then(() => {
                        return houseKeeping.call(self, app);
                    });
                }
            }).then(() => {
                return app;
            });
        });
    };

    const createNewRun = function (us) {
        const self = this;

        var run = {
            usId: us._id,
            appId: us.appId,
            sequence: us.lastBuildSequence,
            state: 'pending',
            ts: Date.now(),
            config: null,
            commitId: null,
            buildOnHost: null,
            buildPass: null,
            buildResults: {},
            build: {},
            collision: {
                state: null,
                hasCollisions: null,
                collisionResolved: null,
                remoteUpdateSetID: null,
                remoteUpdateSetUrl: null,
                issues: [],
                solution: {
                    user: {
                        name: null,
                        fullName: null,
                        email: null
                    },
                    resolutions: {}
                }
            }
        };
        return self.db.run.insert(run);
    };

    const getUs = function ({ appId, updateSet }) {
        const self = this;

        var defaults = {
            updateSetId: updateSet.sys_id,
            updateSet: updateSet,
            name: updateSet.name,
            appId: appId,
            running: false,
            lastBuildSequence: 0,
            lastSuccessfulRun: null
        };

        return self.db.us.findOne({
            appId: appId,
            updateSetId: updateSet.sys_id
        }).then((_us) => {
            return Promise.try(() => {
                if (_us) {
                    // in case the default model changes, merge
                    // update the update-set information
                    const us = assign({}, defaults, _us, { // always refresh the update-set
                        updateSet: updateSet,
                        name: updateSet.name
                    });

                    return self.db.us.update(us).then(() => us);
                } else {
                    return self.db.us.insert(defaults).then((us) => us);
                }
            });
        });
    };

    const configure = function (config = {}, logger = console) {
        const self = this;
        let app, us, run;

        //console.log('project-setup configure');
        //console.log('%j', config);

        const step = (message, error) => {
            return self.addStep(logger, config, `${path.basename(__filename).split('.')[0]} : ${message}`, error);
        };

        return Promise.try(() => {

            if (!get(['updateSet'], config)) {
                throw Error('Configuration Error: update set is not defined in config.updateSet');
            }

            if (!get(['host', 'name'], config)) {
                throw Error('Configuration Error: source server host name not defined in config.host.name');
            }

            // switch if masterBranch is enabled
            config.master.enabled = (get(['master', 'name'], config) && get(['master', 'host', 'name'], config)) ? true : false;

            // switch if ATF is enabled
            config.atf.enabled = (process.env.CICD_ATF_ENABLED === 'false') ? false : true;

        }).then(() => {
            /*
                TODO: is this still needed? 
                The creation of an update set based on a scoped app requires high privileges, better the user creates the update set manually in ServiceNow and
                triggers the job from there.
            */
            // in case of CICD on scoped app, generate first an update-set based on the app.
            if (config.updateSet.application !== undefined) {
                return step(`CICD run on a scoped app. Convert app '${config.updateSet.application}' to an update-set`).then(() => {
                    return self.getClient(config).exportApplication(config.updateSet.application);
                }).then((updateSetSysId) => {
                    config.updateSet = updateSetSysId;
                });
            }
        }).then(() => {
            return self.getUpdateSetDetails(config).then(() => {
                // set the branch name
                config.branchName = `${config.updateSet.name}-@${config.updateSet.sys_id}`;
            });

        }).then(() => {
            // get the config object from the db
            return getApplication.call(self, config.application).then((_app) => {
                app = _app;
                config.build.applicationId = app._id;
            });

        }).then(() => {
            // get the job object from the db
            return getUs.call(self, { appId: config.build.applicationId, updateSet: config.updateSet }).then((_us) => {
                if (_us.pullRequestRaised)
                    throw Error('there is already a pending pull request for this update-set');

                if (_us.running) {
                    //throw 'job already running';
                    throw Error('there is already a build job running for this update-set');
                }
                _us.running = true;
                return self.db.us.update(_us).then(() => _us);

            }).then((_us) => {
                us = _us;
                us.lastBuildSequence++;
                us.uuid = uuidv4().toLowerCase();
                config.build.usId = us._id;

                // create a new run and increase the counter on the job
                return createNewRun.call(self, us).then((_run) => {
                    run = _run;
                    config.build.runId = run._id;
                    config.build.sequence = run.sequence;

                    config.build.artifact = path.join('us', config.updateSet.scopeName, `sys_update_set_${config.updateSet.sys_id}.xml`);

                    us.runId = run._id;

                }).then(() => {
                    return self.db.us.update(us);
                });

            });

        }).then(() => {
            //console.log(self.settings.documentsRootDir, config.build.applicationId, us.updateSetId, (run.sequence).toString());
            // (process.env.CICD_CODE_DIRECTORY) ? path.resolve(process.env.CICD_CODE_DIRECTORY) : path.resolve(tempDir, 'git-root')
            config.application.dir = {
                code: path.resolve(self.settings.gitRepoRootDir, us.uuid), // , (config.build.sequence).toString()
                doc: path.resolve(self.settings.documentsRootDir, config.build.applicationId, us.updateSetId, (run.sequence).toString()), // , (config.build.sequence).toString()
                tmp: path.resolve(self.settings.tempBuildRootDir, us.uuid),
                web: [config.build.applicationId, us.updateSetId, (run.sequence).toString()].join('/')
            };

            const port = [443, 80].some((p) => (p === self.settings.server.port)) ? '' : `:${self.settings.server.port}`;
            config.application.docUri = `${self.settings.server.hostName}${port}/goto/run/${config.build.runId}`;
            run.dir = config.application.dir;

            // set the run state so progress is visible in the ui
            run.state = self.run.PROJECT_SETUP;
            return self.db.run.update(run);

        }).then(() => {
            if (process.env.CICD_GIT_HOST && get(['git', 'repository'], config) && !get(['git', 'remoteUrl'], config)) {
                config.git.remoteUrl = url.resolve(process.env.CICD_GIT_HOST, `${config.git.repository}.git`);
                return step(`Git RemoteUrl set from ENV.CICD_GIT_HOST to '${config.git.remoteUrl}'`);
            }
        }).then(() => {
            if (process.env.CICD_GIT_URL && get(['git', 'repository'], config) && !get(['git', 'url'], config)) {
                config.git.url = url.resolve(process.env.CICD_GIT_URL, `${config.git.repository}`);
                return step(`Git RemoteUrl set from ENV.CICD_GIT_URL to '${config.git.url}'`);
            }
        }).then(() => {

            assign(app, config.application);
            return self.db.application.update(app);

        }).then(() => {
            return step(`Remove Dir '${config.application.dir.code}' if exists`).then(() => {
                return fs.removeAsync(path.resolve(config.application.dir.code));
            });
        }).then(() => {

            const git = self.getGit(config);
            return Promise.try(() => {
                if (config.master.enabled) {
                    return git.toBranchName(config.master.name).then((name) => {
                        config.master.name = name;
                    });
                }
            }).then(() => {
                return git.toBranchName(config.branchName).then((name) => {
                    config.branchName = name;
                });
            }).then(() => {
                if (process.env.CICD_GIT_BRANCH_LINK_TEMPLATE && get(['git', 'repository'], config) && !get(['git', 'branchLink'], config)) {
                    // '${url}/browse?at=refs%2Fheads%2F${branchName}'
                    // https://github.com/bmoers/sn-cicd-demo/tree/cicd-integration-1-1-6-%403616eaf3db02230051cefbef299619ef
                    config.git.branchLink = fillTemplate(process.env.CICD_GIT_BRANCH_LINK_TEMPLATE, { url: config.git.url, branchName: config.branchName });
                }
            }).then(() => {
                // !! dunno if app still needs the git object....
                assign(app, {
                    git: {
                        url: config.git.url,
                        remoteUrl: config.git.remoteUrl,
                        repository: config.git.repository
                    }
                });
                return self.db.application.update(app);
            }).then(() => {
                // update the run object as git init takes a while.
                run.config = config;
                return self.db.run.update(run);
            }).then(() => {
                if (config.git.enabled === true) {
                    return Promise.try(() => {
                        return step(`Create remote repository (if needed) '${config.git.repository}'`);
                    }).then(() => {
                        return self.createRemoteRepo(config, config.git.repository);
                    }).then(() => {
                        return step(`Initialize GIT locally and refresh from remote`);
                    }).then(() => {
                        return git.init('no-cicd');
                    }).then(() => {
                        return git.switchToBranch(config.master.name);
                    });
                }
            }).then(() => {
                return Promise.try(() => {
                    return step(`Setup Project '${config.application.name}' on disc '${config.application.dir.code}'`);
                }).then(() => {
                    return self.getProject(config).then((project) => {
                        return project.setup();
                    });
                }).then(() => {
                    if (config.git.enabled === true) {
                        return git.addAll().then(() => {
                            return git.commit({
                                messages: [`Project configuration updated.`, `no-cicd`]
                            });
                        }).then(() => {
                            return git.push(config.master.name)
                        });
                    }
                });
            });
        }).then(() => {
            // add config to update-set to be used in the deployment later (from the db)
            run.config = config;
            return self.db.run.update(run);
        }).then(() => {
            //console.log('project-setup ctx:');
            //console.log('%j', config);
            return {
                runId: config.build.runId,
                config: config
            };
        });

    };

    const config = assign({
        build: {
            requestor: {
                userName: null,
                fullName: null,
                email: null
            },
            sequence: -1,
            commitId: null,
            applicationId: null,
            usId: null,
            runId: null,
            collisionDetection: (process.env.CICD_CONFLICT_DETECTION_ENABLED == 'true') ? true : false
        },
        atf: {
            updateSetOnly: false,
            enabled: false
        },
        updateSet: null, // the sys_id of the update set or an application object {application: 'sys_id'} to be extracted
        branchName: null,
        application: {
            includeUnknownEntities: true,
            allEntitiesAsJson: true,
            id: null,
            name: null,
            organization: process.env.CICD_ORGANIZATION || 'company',
            mergedDeployment: (process.env.CICD_CD_DEPLOY_ALWAYS_MERGED == 'true') ? true : false,
            forcedDeployment: (process.env.CICD_CD_DEPLOY_ALWAYS_OVERWRITE == 'true') ? true : false,
        },
        git: {
            repository: null,
            remoteUrl: null,
            url: null,
            enabled: false,
            pullRequestEnabled: false,
            branchLink: null
        },
        host: {
            name: null
        },
        master: {
            name: "master",
            host: {
                name: null
            },
            enabled: false
        },
        deploy: {
            host: {
                name: null
            },
            onBuildPass: false,
            onPullRequestResolve: false,
            enabled: false
        }
    }, options, {
        application: {
            includeUnknownEntities: (process.env.CICD_EXPORT_UNKNOWN_TYPES === 'false') ? false : true,
            allEntitiesAsJson: (process.env.CICD_EXPORT_ALL_AS_JSON === 'false') ? false : true,
            nullForEmpty: Boolean(process.env.CICD_EXPORT_NULL_FOR_EMPTY === 'true'),
            sysFieldWhiteList: (() => {
                if (process.env.CICD_EXPORT_SYS_FIELD_WHITELIST) {
                    return process.env.CICD_EXPORT_SYS_FIELD_WHITELIST.split(',').map((field) => {
                        return field.trim();
                    }).filter((field) => {
                        return Boolean(field);
                    });
                }
                return undefined;
            })()
        },
        git: {
            enabled: (process.env.CICD_GIT_ENABLED === 'true') ? true : false,
            pullRequestEnabled: (process.env.CICD_GIT_PR_ENABLED === 'true') ? true : false,
            deleteBranchOnMerge: (process.env.CICD_GIT_DELETE_BRANCH_ON_MERGE === 'true') ? true : false,
        },
        deploy: {
            onBuildPass: (process.env.CICD_CD_DEPLOY_ON_BUILD_PASS === 'true') ? true : false,
            onPullRequestResolve: (process.env.CICD_CD_DEPLOY_ON_PR_RESOLVE === 'true') ? true : false
        }
    });

    if (config.host.name)
        config.host.name = config.host.name.toLowerCase().replace(/\/$/, "");

    if (config.master.host.name)
        config.master.host.name = config.master.host.name.toLowerCase().replace(/\/$/, "");

    if (config.deploy.host.name)
        config.deploy.host.name = config.deploy.host.name.toLowerCase().replace(/\/$/, "");

    if (process.env.CICD_CD_STRICT_DEPLOYMENT == 'true') {
        const m = config.host.name.match(/(?:http[s]?:\/\/)([^\.]*)([^:\/]*)/i);
        const sourceInstanceName = (m) ? m[1] : config.host.name;

        const targetHostName = process.env[`CICD_CD_DEPLOYMENT_TARGET_${sourceInstanceName.toUpperCase()}`] || process.env.CICD_CD_DEPLOYMENT_TARGET
        if (targetHostName) {
            config.deploy.host = {
                name: `https://${targetHostName}`
            };
        }
    }

    if (process.env.CICD_GIT_STRICT_MASTER == 'true') {
        const m = config.host.name.match(/(?:http[s]?:\/\/)([^\.]*)([^:\/]*)/i);
        const sourceInstanceName = (m) ? m[1] : config.host.name;

        const targetHostName = process.env[`CICD_GIT_MASTER_SOURCE_${sourceInstanceName.toUpperCase()}`] || process.env.CICD_GIT_MASTER_SOURCE
        if (targetHostName) {
            config.master.host = {
                name: `https://${targetHostName}`
            };
        }
    }

    // always merge all update sets 
    config.application.mergedDeployment = Boolean(config.application.mergedDeployment);
    // ensure the new records are deployed - even if there is a newer on the target environment
    config.application.forcedDeployment = Boolean(config.application.forcedDeployment);

    config.application.organization = config.application.organization.replace(/\W/g, '_');
    config.deploy.enabled = Boolean(config.deploy && config.deploy.host && config.deploy.host.name);

    return configure.call(self, config, logger);


};
