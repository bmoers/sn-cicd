const Promise = require('bluebird');
const path = require("path");
const fs = Promise.promisifyAll(require("fs-extra"));


module.exports = function (ctx) {
    const self = this;
    const config = ctx.config;
    let git;

    const step = (message, error) => {
        return self.addStep(config, `${path.basename(__filename).split('.')[0]} : ${message}`, error);
    };

    
    return Promise.try(() => {
        return self.build.setProgress(ctx, this.build.IN_PROGRESS);

    }).then(() => {
        // only pull from MasterBranch if enabled
        if (!config.branch.enabled)
            return;

        return Promise.try(() => { 
            // init the remote client
            config.branch.settings = config.settings;
            ctx.remote = self.getClient(config.branch); // used in getApplicationFiles() and processFilesByClass()

            config.application.git.dir = path.join(config.application.id, (config.build.sequence).toString());
            git = self.getGit(ctx);

            //ctx.client = self.getClient(config);

        }).then(() => {
            return step(`switch to branch '${config.branch.name}'`);

        }).then(() => { // check if already a pull request open
            if (config.application.git.pullRequestEnabled) {
                return Promise.try(() => {
                    return step(`Pull request is enabled. Check for pending pull request'`);
                }).then(() => {
                    return self.pendingPullRequest({
                        ctx: ctx,
                        repoName: config.application.git.repository,
                        from: config.branchName
                    });
                }).then((pending) => {
                    if (pending)
                        throw Error('There is already a pending pull request on this update-set.');
                });
            }
        }).then(() => { // prepare git 

            if (config.application.git.enabled === true) {
                return Promise.try(() => {
                    return step(`Switch to branch ${config.branch.name} and clean up all files`);
                }).then(() => {
                    return git.switchToBranch(config.branch.name);
                }).then(() => {
                    return git.fetch('-p');
                }).then(() => {
                    return step(`Delete all files in '${config.branch.name}'`, path.join(config.application.dir.code, 'sn'));
                }).then(() => {
                   return fs.removeAsync(path.join(config.application.dir.code, 'sn'));
                });
            }

        }).then(() => { // load all application data from remote. typically from sys_metadata.

            return Promise.try(() => {
                return step(`Load all file header (metadata) from ${config.branch.host.name}`);
            }).then(() => {
                return self.getApplicationFiles(ctx);
            }).then((files) => {
                return step(`Load all files by class from ${config.branch.host.name}`).then(() => files);
            }).then((files) => {
                return self.processFilesByClass(ctx, files);
            });


        }).then(() => { // commit all remote files

            if (config.application.git.enabled === true) {
                return Promise.try(() => {
                    return step(`Update branch '${config.branch.name}' with modified files from '${config.branch.host.name}'.`);
                }).then(() => {
                    return git.add('-A'); // add all. new, modified, deleted
                }).then(() => {
                    return git.commit({
                        messages: [`${config.branch.name} branch updated from  ${config.branch.host.name}`]
                    });
                }).then(() => {
                    return git.push();
                });
            }
        });
    });
};