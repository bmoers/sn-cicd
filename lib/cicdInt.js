
var Promise = require('bluebird');
var Git = require("./git");
var Slack = require("./slack");

var CICDInt = function () { };
CICDInt.prototype = {
    
    Git: Git,
    Slack: Slack,

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
        }
    },

    configure: function () {
        return Promise.try(() => { });
    },

    createRemoteRepo: function (ctx, repoName) { 
        console.log('=====> Extend CICD \'CICD.prototype.createRemoteRepo \' with your own code to check if there is already a pending pull request', repoName);
        return Promise.try(() => { });
    },
    pendingPullRequest: function ({ ctx, repoName, from }) {
        console.log('=====> Extend CICD \'CICD.prototype.pendingPullRequest \' with your own code to check if there is already a pending pull request', repoName, from);
        return Promise.try(() => { return false; });
    },

    raisePullRequest: function ({ ctx, requestor, repoName, from, to, title, description }) { 
        console.log('=====> Extend CICD \'CICD.prototype.raisePullRequest \' with your own code to raise a pull request', requestor, repoName, from, to, title, description);
        return Promise.try(() => { 
            return this.build.setProgress(ctx, this.build.COMPLETE);
        });
    },
    
    build: {
        IN_PROGRESS: 'build_in_progress',
        CODE_REVIEW_PENDING: 'code_review_pending',
        CODE_REVIEW_REJECTED: 'code_review_rejected',
        DEPLOYMENT_IN_PROGRESS: 'deployment_in_progress',
        DEPLOYMENT_MANUAL_INTERACTION: 'deployment_manual_interaction',
        FAILED: 'build_failed',
        COMPLETE: 'complete',
        setProgress: function (ctx, state) {
            return Promise.try(() => { });
        }
    },

    getApplicationFiles: function (ctx) {
        console.log('Extend CICD \'CICD.prototype.getApplicationFiles \' with your own code to export all files except the ones in the current update-set');
        return Promise.try(() => { return []; });
    },

    getApplicationTestSuites: function (ctx) {
        console.log('Extend CICD \'CICD.prototype.getApplicationTestSuites \' with your own code to extract all TestSuites belonging to this App');
        return Promise.try(() => { return []; });
    },

    getApplicationTests: function (ctx) {
        console.log('Extend CICD \'CICD.prototype.getApplicationTests \' with your own code to extract all TestSuites belonging to this App');
        return Promise.try(() => { return []; });
    },

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

    /**
     * Convert the request body to the options format 
     * used in buildUpdateSetOnBranch()
     * 
     * @param {any} body the request body
     * @returns {Promise<Object>} the converted body
     */
    convertBuildBody: function (body) {
        return Promise.try(() => {
            return body;
        });
    },

    /**
     * Convert the request body to the options format 
     * used in gitPullRequestUpdate()
     * 
     * @param {any} body the request body
     * @returns {Promise<Object>} the converted body
     */
    convertPullBody: function (body) {
        return Promise.try(() => {
            return body;
        });
    }
};
module.exports = CICDInt;