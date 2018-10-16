const Promise = require('bluebird');
const path = require("path");
const fs = Promise.promisifyAll(require("fs-extra"));

/**
 * Export all files of an application from 'master'. 
 * This is to reset the master branch.
 *
 * @param {*} runId id of the current run
 * @param {Console} logger a logger to be used
 * @param {Object} job job object 
 * @returns {Promise}
 */
module.exports = function (runId, logger = console, { host }) {
    const self = this;
    let config = {};
    let git;

    const step = (message, error) => {
        return self.addStep(logger, config, `${path.basename(__filename).split('.')[0]} : ${message}`, error);
    };
    
    return Promise.try(() => {
        return self.db.run.get(runId).then((run) => {
            if (!run)
                throw Error(`Run not found with id ${runId}`);
            config = run.config;
        });

    }).then(() => {
        return self.setProgress(config, this.build.IN_PROGRESS);

    }).then(() => {
        // only pull from MasterBranch if enabled
        if (!config.master.enabled)
            return step(`Master branch is not enabled. Skip export' ${config.master}`);

        return Promise.try(() => { 
            // init the remote client
            config.git.dir = path.join(config.build.applicationId, (config.build.sequence).toString());
            git = self.getGit(config);

        }).then(() => {
            return step(`switch to branch '${config.master.name}'`);

        }).then(() => { // check if already a pull request open
            if (config.git.pullRequestEnabled) {
                return Promise.try(() => {
                    return step(`Pull request is enabled. Check for pending pull request'`);
                }).then(() => {
                    return self.pendingPullRequest({
                        config,
                        repoName: config.git.repository,
                        from: config.branchName
                    });
                }).then((pending) => {
                    if (pending)
                        throw Error('There is already a pending pull request on this update-set.');
                });
            }
        }).then(() => { // prepare git 

            if (config.git.enabled === true) {
                return Promise.try(() => {
                    return step(`Switch to branch ${config.master.name} and clean up all files`);
                }).then(() => {
                    return git.switchToBranch(config.master.name);
                }).then(() => {
                    return git.fetch('-p');
                }).then(() => {
                    return step(`Delete all files in '${config.master.name}'`, path.join(config.application.dir.code, 'sn'));
                }).then(() => {
                   return fs.removeAsync(path.join(config.application.dir.code, 'sn'));
                });
            }

        }).then(() => { // load all application data from remote. typically from sys_metadata.

            return Promise.try(() => {
                return step(`Load all file header (metadata) from ${config.master.host.name}`);
            }).then(() => {
                return self.getApplicationFiles(config);
            }).then((files) => {
                return step(`Load all files by class from ${config.master.host.name}`).then(() => files);
            }).then((files) => {
                return self.processFilesByClass(config, files);
            });


        }).then(() => { // commit all remote files

            if (config.git.enabled === true) {
                return Promise.try(() => {
                    return step(`Update branch '${config.master.name}' with modified files from '${config.master.host.name}'.`);
                }).then(() => {
                    return git.add('-A'); // add all. new, modified, deleted
                }).then(() => {
                    return git.commit({
                        messages: [`${config.master.name} branch updated from  ${config.master.host.name}`]
                    });
                }).then(() => {
                    return git.push();
                });
            }
        });
    });
};