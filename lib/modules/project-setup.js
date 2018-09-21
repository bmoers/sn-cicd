const assign = require('object-assign-deep');
const path = require("path");
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require("fs-extra"));
const url = require('url');

const get = require('../get');

const houseKeeping = function (app) {
    const self = this;
    var maxRun = 20;

    console.log('*** house keeping ***');
    return Promise.try(() => {
        return self.db.us.find({
            app: app._id
        });
    }).then((usList) => {
        console.log('check all update-set to be deleted. total #', (usList || []).length);

        return Promise.each(usList || [], (us) => {

            return Promise.try(() => {
                return self.db.run.find({
                    us: us._id
                });
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
                        return self.db.step.find({
                            run: run._id
                        }).then((stepList) => {
                            return Promise.each(stepList || [], (step) => {
                                return self.db.step.delete(step);
                            });
                        }).then(() => {
                            console.log(`\tdelete the run # ${run._id}`);
                            return self.db.run.delete(run);
                            /*
                            TODO: directory cleanup must be done else.
                            Worker nodes do not have access to this...

                            return Promise.each(Object.keys(run.dir || {}), (dir) => {
                                var directory = run.dir[dir];
                                console.log(`\t\tdelete all files in '${directory}'`);
                                return fs.removeAsync(directory);
                            }).then(() => {
                                return self.db.run.delete(run);

                            });
                            */
                        });
                    });
                }
            });
        });

    });
};

const getApplication = function (application) {
    const self = this;
    var app = {
        _id: application.id,
        application: application
    };

    return self.db.application.get({
        _id: app._id
    }).then((result) => {
        return Promise.try(() => {
            if (!result) {
                return self.db.application.insert(app).then((result) => {
                    app = result;
                });
            } else {
                return Promise.try(() => {
                    // in case the application info change
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
        us: us._id,
        app: us.app,
        sequence: us.lastBuildSequence,
        state: 'pending',
        ts: new Date().getTime()
    };
    return self.db.run.insert(run);
};

const getUsFromDb = function (config) {
    const self = this;

    var app = config.build.run.app;
    var usDefault = {
        updateSetId: config.updateSet.sys_id,
        updateSet: config.updateSet,
        name: config.updateSet.name,
        app: app._id,
        running: false,
        lastBuildSequence: 0,
        lastSuccessfulRun: null,
        state: 'pending',
        commitId: null,
        testResults: null,
        testJob: null,
        buildOnHost: null,
        buildPass: null,
        buildResults: {
        },
        build: {
            init: {
                breakOnError: true
            },
            lint: {
                breakOnError: false,
                files: [],
                config: {}
            },
            doc: {
                breakOnError: false,
                config: {}
            },
            test: {
                breakOnError: false,
                suites: [],
                tests: [],
                title: ""
            }
        }
    };

    return self.db.us.find({
        app: app._id,
        updateSetId: config.updateSet.sys_id
    }).then((result) => {
        //console.log('getUsFromDb find', result);
        return Promise.try(() => {
            if (result && result.length) {
                // in case the default model changes, merge
                const us = assign({}, usDefault, result[0]);
                return self.db.us.update(us).then(() => {
                    return us;
                });
                
            } else {
                return self.db.us.insert(usDefault).then((result) => {
                    return result;
                });
            }
        }).then((us) => {
            //us
            return us;
        });
    });
};

const configure = function (ctx, entry) {
    const self = this;
    
    const step = (message, error) => {
        return self.addStep(ctx.config, `${path.basename(__filename).split('.')[0]} : ${message}`, error);
    };

    return Promise.try(() => {
        // copy global settings into config
        ctx.config.settings = assign({}, self.settings);

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
        
        return self.loadUpdateSet(ctx);

    }).then(() => {

        // get the config object from the db
        return getApplication.call(self, ctx.config.application).then((app) => {
            ctx.config.build.run.app = app;
        }).then(() => {
            return self.db.application.update(ctx.config.build.run.app);
        });

    }).then(() => {
        // get the job object from the db

        return getUsFromDb.call(self, ctx.config).then((us) => {
            if (us.running) {
                //throw 'job already running';
                //console.warn('there is already a build job running for this update-set', ctx.config.build.run.app, us);
                throw Error('there is already a build job running for this update-set');
            }

            us.lastBuildSequence++;
            us.buildPass = null;
            us.buildResults = {};
            us.testResults = null;
            us.testJob = null;
            us.buildOnHost = null;

            // always refresh the update-set
            us.updateSet = ctx.config.updateSet;
            us.name = ctx.config.updateSet.name;

            us.running = true;
            ctx.config.build.run.us = us;

            return self.db.us.update(us);

        }).then(() => {
            // create a new run and increase the counter on the job
            return createNewRun.call(self, ctx.config.build.run.us).then((run) => {
                ctx.config.build.run.instance = run;
            });

        }).then(() => {
            ctx.config.build.sequence = ctx.config.build.run.instance.sequence;

        });

    }).then(() => {

        ctx.config.application.dir = {
            code: path.resolve(ctx.config.settings.gitRepoRootDir, ctx.config.application.id, (ctx.config.build.sequence).toString()),
            doc: path.resolve(ctx.config.settings.documentsRootDir, ctx.config.application.id, (ctx.config.build.sequence).toString()),
            tmp: path.resolve(ctx.config.settings.tempBuildRootDir, ctx.config.application.id)
        };

        ctx.config.application.docUri = `${self.settings.server.hostName}${(self.settings.server.port) ? `:${self.settings.server.port}` : ''}/steps.html#/app/${ctx.config.build.run.app._id}/us/${ctx.config.build.run.us._id}/run/${ctx.config.build.run.instance._id}`;

    }).then(() => {
        ctx.config.build.run.instance.dir = ctx.config.application.dir;
        return self.db.run.update(ctx.config.build.run.instance);

     }).then(() => {

        if (process.env.CICD_GIT_HOST && get(['application', 'git', 'repository'], ctx.config) && !get(['application', 'git', 'remoteUrl'], ctx.config)) {
            ctx.config.application.git.remoteUrl = url.resolve(process.env.CICD_GIT_HOST, ctx.config.application.git.repository);
            return step(`Git RemoteUrl set from ENV.CICD_GIT_HOST to '${ctx.config.application.git.remoteUrl}'`);
        }

    }).then(() => {

        return step(`Remove Dir '${ctx.config.application.dir.code}' if exists`).then(() => {
            return fs.removeAsync(path.resolve(ctx.config.application.dir.code));
        });
        
    }).then(() => {

        const git = self.getGit(ctx);
        return Promise.try(() => {
            if (ctx.config.branch.enabled) {
                return git.toBranchName(ctx.config.branch.name).then((branchName) => {
                    ctx.config.branch.name = branchName;
                });
            }
        }).then(()=>{
            return git.toBranchName(ctx.config.branchName).then((branchName) => {
                ctx.config.branchName = branchName;
            });
        }).then(() => {
            ctx.config.build.run.us.branchName = ctx.config.branchName;
            return self.db.us.update(ctx.config.build.run.us);
        }).then(() => {

            if (ctx.config.application.git.enabled === true) {

                return Promise.try(() => {
                    return step(`Create remote repository (if needed) '${ctx.config.application.git.repository}'`);
                }).then(() => {
                    return self.createRemoteRepo(ctx, ctx.config.application.git.repository);
                }).then(() => {
                    return step(`Initialize GIT locally and refresh from remote`);
                }).then(() => {
                    return git.init();
                });
            }
        });
    }).then(() => {
        return step(`Setup Project '${ctx.config.application.name}' on disc '${ctx.config.application.dir.code}'`).then(() => {
            return self.getProject(ctx.config).setup();
        });
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
        return self.db.us.update(ctx.config.build.run.us);
    }).then(() => {
        return ctx;
    });

};


/**
 * Extension for CICD
 *
 * @param {*} num
 */
module.exports = function (options) {
    const self = this;

    var ctx = options.ctx || {
        config: null,
        client: null,
        project: null
    };

    ctx.config = assign({
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
            updateSetOnly: false,
            credentials: {
                oauth: {
                    accessToken: null,
                    refreshToken: null,
                    clientId: null,
                    clientSecret: null
                }
            }
        },
        updateSet: null,
        application: {
            includeUnknownEntities: (process.env.CICD_EXPORT_UNKNOWN_TYPES === 'false') ? false : true,
            id: null,
            name: null,
            organization : null,
            git: {
                repository: null,
                remoteUrl: null,
                enabled: false,
                pullRequestEnabled: false
            }
        },
        host: {
            name: null
        },
        branch: {
            name: "master",
            host: {
                name: null
            }
        },
    }, options.options || {});

    return configure.call(self, ctx);
};