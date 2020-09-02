const Promise = require('bluebird');
const assign = require('object-assign-deep');
const EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits

const CICDInt = function () {
    EventEmitter.call(this);
};

CICDInt.prototype = {

    emit: EventEmitter.prototype.emit,
    once: EventEmitter.prototype.once,

    Git: require("sn-project/lib/git"),
    Slack: require("./slack"),
    SnClient: require('./snClient'),

    db: {
        application: {
            get: function () {
                return Promise.try(() => { });
            },
            insert: function () {
                return Promise.try(() => { });
            },
            update: function () {
                return Promise.try(() => { });
            },
            delete: function () {
                return Promise.try(() => { });
            },
            find: function () {
                return Promise.try(() => { });
            }
        },
        us: {
            get: function () {
                return Promise.try(() => { });
            },
            insert: function () {
                return Promise.try(() => { });
            },
            update: function () {
                return Promise.try(() => { });
            },
            delete: function () {
                return Promise.try(() => { });
            },
            find: function () {
                return Promise.try(() => { });
            }
        },
        run: {
            get: function () {
                return Promise.try(() => { });
            },
            insert: function () {
                return Promise.try(() => { });
            },
            update: function () {
                return Promise.try(() => { });
            },
            delete: function () {
                return Promise.try(() => { });
            },
            find: function () {
                return Promise.try(() => { });
            }
        },
        step: {
            get: function () {
                return Promise.try(() => { });
            },
            insert: function () {
                return Promise.try(() => { });
            },
            update: function () {
                return Promise.try(() => { });
            },
            delete: function () {
                return Promise.try(() => { });
            },
            find: function () {
                return Promise.try(() => { });
            }
        },
        test: {
            get: function () {
                return Promise.try(() => { });
            },
            insert: function () {
                return Promise.try(() => { });
            },
            update: function () {
                return Promise.try(() => { });
            },
            delete: function () {
                return Promise.try(() => { });
            },
            find: function () {
                return Promise.try(() => { });
            }
        },
        deployment: {
            get: function () {
                return Promise.try(() => { });
            },
            insert: function () {
                return Promise.try(() => { });
            },
            update: function () {
                return Promise.try(() => { });
            },
            delete: function () {
                return Promise.try(() => { });
            },
            find: function () {
                return Promise.try(() => { });
            }
        }
    },

    configure: function () {
        return Promise.try(() => { });
    },

    createRemoteRepo: function (config, repoName) {
        console.log('=====> Extend CICD \'CICD.prototype.createRemoteRepo \' with your own code to check if there is already a pending pull request', repoName);
        return Promise.try(() => { });
    },
    pendingPullRequest: function ({ config, repoName, from }) {
        console.log('=====> Extend CICD \'CICD.prototype.pendingPullRequest \' with your own code to check if there is already a pending pull request', repoName, from);
        return Promise.try(() => { return false; });
    },

    raisePullRequest: function ({ config, requestor, repoName, from, to, title, description }) {
        console.log('=====> Extend CICD \'CICD.prototype.raisePullRequest \' with your own code to raise a pull request', requestor, repoName, from, to, title, description);
        return Promise.try(() => {
            return this.setProgress(config, this.build.COMPLETE);
        });
    },


    email: {
        onPreviewConflicts: function ({ recipient, subject, data }) {
            console.log('=====> Extend CICD \'CICD.prototype.email.onPreviewConflicts \' with your own code to send an email notification', recipient, subject, data);
        },
        onDeploymentConflicts: function ({ recipient, subject, data }) {
            console.log('=====> Extend CICD \'CICD.prototype.email.onDeploymentConflicts \' with your own code to send an email notification', recipient, subject, data);
        },
        onDeploymentFailure: function ({ recipient, subject, data }) {
            console.log('=====> Extend CICD \'CICD.prototype.email.onDeploymentFailure \' with your own code to send an email notification', recipient, subject, data);
        },
        onDeploymentHasMissingRecords: function ({ recipient, subject, data }) {
            console.log('=====> Extend CICD \'CICD.prototype.email.onDeploymentHasMissingRecords \' with your own code to send an email notification', recipient, subject, data);
        },
        onBuildFailure: function ({ recipient, subject, data }) {
            console.log('=====> Extend CICD \'CICD.prototype.email.onBuildFailure \' with your own code to send an email notification', recipient, subject, data);
        },
        text: function (recipient, subject, text) {
            console.log('=====> Extend CICD \'CICD.prototype.email.text \' with your own code to send an email notification', recipient, subject, text);
        }
    },

    build: {
        BUILD_REQUESTED: 'build',
        IN_PROGRESS: 'build_in_progress',
        CODE_REVIEW_PENDING: 'code_review_pending',
        CODE_REVIEW_REJECTED: 'code_review_rejected',
        DEPLOYMENT_IN_PROGRESS: 'deployment_in_progress',
        DEPLOYMENT_MANUAL_INTERACTION: 'deployment_manual_interaction',
        FAILED: 'build_failed',
        CANCELLED: 'build_cancelled',
        COMPLETE: 'complete',
        COLLISION_REVIEW_PENDING: 'conflict_review_in_progress',
        COLLISION_REVIEW_PASSED: 'conflict_review_passed'
    },

    run: {
        UNDEFINED: 'undefined',
        RUNNING: 'running',
        ERROR: 'error',
        SUCCESSFUL: 'successful',

        PROJECT_SETUP: 'project setup',
        EXPORT_FILES: 'export files from master',
        EXPORT_UPDATE_SET: 'export update set',

        CONFLICT_DETECTION: 'detecting conflicts',
        CONFLICT_PASSED: 'no conflicts',
        CONFLICT: 'conflicts detected',
        CONFLICT_PREVIEW_CANCELLED: 'conflicts preview cancelled',
        CONFLICT_RESOLVED: 'conflicts resolved',

        BUILD_IN_PROGRESS: 'build in progress',
        BUILD_FAILED: 'build failed',
        BUILD_COMPLETED: 'build completed',
        EXPORT_IN_PROGRESS: 'export in progress',
        PULL_REQUEST_RAISED: 'pull request raised',
        PULL_REQUEST_REJECTED: 'pull request rejected',
        PULL_REQUEST_APPROVED: 'pull request approved',
        COMPLETED_NO_DEPLOY: 'successful (no deploy)',
        COMPLETED_DEPLOYMENT_IN_PROGRESS: 'deployment in progress',
        COMPLETED_DEPLOYMENT_COMPLETED: 'successful (deployment completed)',
        COMPLETED_DEPLOYMENT_FAILED: 'failed',
        COMPLETED_DEPLOYMENT_MANUAL_ACTION: 'failed (manual interaction required)'
    },

    setRunState: function (config, state) {
        return Promise.try(() => { });
    },

    setProgress: function (config, state) {
        return Promise.try(() => { });
    },

    getApplicationFiles: function (config) {
        console.log('=====> Extend CICD \'CICD.prototype.getApplicationFiles \' with your own code to export all files except the ones in the current update-set');
        return Promise.try(() => { return []; });
    },

    getApplicationTestSuites: function (config) {
        console.log('=====> Extend CICD \'CICD.prototype.getApplicationTestSuites \' with your own code to extract all TestSuites belonging to this App');
        return Promise.try(() => { return []; });
    },

    getApplicationTests: function (config) {
        console.log('=====> Extend CICD \'CICD.prototype.getApplicationTests \' with your own code to extract all TestSuites belonging to this App');
        return Promise.try(() => { return []; });
    },

    /*
    buildUpdateSetOnBranch: function (options) {
        return Promise.try(() => { });
    },
    buildUpdateSet: function (options) { 
        return Promise.try(() => { });
    },
    exportUpdateSet: function (options) { 
        return Promise.try(() => { });
    },
    deployUpdateSet: function (options) {
        return Promise.try(() => { });
    },
    */

    /**
     * Convert the request body to the options format 
     * used in buildUpdateSetOnBranch()
     * 
     * @param {any} body the request body
     * @returns {Promise<Object>} the converted body
     */
    convertBuildBody: function (body) {
        return Promise.try(() => {

            // this is the object structure used in the cicd-integration app
            var req = assign({
                requestor: {
                    userName: null,
                    fullName: null,
                    email: null
                },
                atf: {
                    name: null,
                    updateSetOnly: false
                },
                updateSet: null,
                application: {
                    id: null,
                    name: null
                },
                git: {
                    repository: null,
                    remoteUrl: null
                },
                source: {
                    name: null,
                },
                master: {
                    name: null
                },
                target: {
                    name: null,
                },
                preflight: {
                    name: null,
                }
            }, body);

            // convert the request params into the CICD config object
            var options = {
                build: {
                    requestor: req.requestor
                },
                atf: {
                    updateSetOnly: req.atf.updateSetOnly
                },
                updateSet: req.updateSet,
                application: {
                    id: req.application.id,
                    name: req.application.name
                },
                git: {
                    repository: req.git.repository,
                    remoteUrl: req.git.remoteUrl
                },
                host: {
                    name: req.source.name
                }
            };
            if (req.master.name) {
                options.master = {
                    host: {
                        name: req.master.name
                    }
                };
            }
            if (req.target.name) {
                options.deploy = {
                    host: {
                        name: req.target.name
                    }
                };
            }
            if (req.preflight.name) {
                options.preflight = {
                    host: {
                        name: req.preflight.name
                    }
                };
            }

            return options;
        });
    },

    /**
     * Convert the request body to the options format 
     * used in gitPullRequestUpdate()
     * 
     * @param {any} body the request body
     * @returns {Promise<Object>} the converted body
     */
    gitPullRequestProxyConvertBody: function (body) {
        return Promise.try(() => {
            return assign({
                action: undefined,
                comment: undefined,
                mergeId: undefined,
                request: {
                    id: undefined,
                    name: undefined,
                    url: undefined
                },
                author: {
                    name: undefined
                },
                reviewers: undefined,
                source: {
                    project: undefined,
                    repository: undefined,
                    branch: undefined
                },
                target: {
                    project: undefined,
                    repository: undefined,
                    branch: undefined
                }
            }, body);
        });
    }
};

CICDInt.prototype.emit = EventEmitter.prototype.emit
CICDInt.prototype.once = EventEmitter.prototype.once
inherits(CICDInt, EventEmitter);

module.exports = CICDInt;
