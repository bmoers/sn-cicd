const Promise = require('bluebird');
const path = require("path");



module.exports = function ({config, id, build}) {
    const self = this;
    const ctx = {
        config: config
    };

    var slack = self.getSlack();

    const step = (message, error) => {
        return self.addStep(config, `${path.basename(__filename).split('.')[0]} : ${message}`, error);
    };

    return self.db.us.get({
        _id: id
    }).then((us) => {
        if (us)
            return us;
        throw new Error(`No Build found with this id: ${id}`);
    }).then((us) => {
        const buildPass = Object.keys(us.buildResults).every((task) => {
            if (build[task].breakOnError) {
                return (us.buildResults[task].testPass === true);
            }
            return true;
        });
        us.buildPass = buildPass;
        return self.db.us.update(us).then(() => us);
    }).then((us) => {
        if (!us.buildPass) {
            return self.build.setProgress(ctx, this.build.FAILED).then(() => {
                return slack.build.failed(`Build for <${config.application.docUri}|${config.updateSet.name}> did not pass!`);
            });
        }

        if (us.buildPass) {
            if (config.application.git.enabled && config.application.git.pullRequestEnabled) {
                return Promise.try(() => {
                    return step('raise pull request');
                }).then(() => {
                    return self.raisePullRequest({
                        ctx: ctx,
                        requestor: config.build.requestor.userName,
                        repoName: config.application.git.repository,
                        from: config.branchName,
                        to: config.branch.name || 'master',
                        title: `${config.build.requestor.fullName} completed '${config.updateSet.name}'. Please review code!`,
                        description: `${config.updateSet.description}\n\nBuild Results: ${config.application.docUri}\n\nCompleted-By: ${config.build.requestor.fullName} (${config.build.requestor.userName})\nCompleted-On: ${config.updateSet.sys_updated_on} UTC\n${config.host.name}/sys_update_set.do?sys_id=${config.updateSet.sys_id}`
                    });
                });
            } else {
                // deploy the update set
                return self.deployUpdateSet(config);

                //#region block
                /* 
                return Promise.try(() => {
                    return step(`complete update-set ${config.updateSet.name}`);
                }).then(() => {
                    return self.build.setProgress(ctx, this.build.COMPLETE);

                }).then(() => {
                
                    if (!(config.deploy && config.deploy.host && ctx.config.deploy.host.name)) {
                        return step(`Deploy is disabled for this update-set`).then(() => {
                            return slack.message(`Deploying Update-Set <${config.host.name}/sys_update_set.do?sys_id=${config.updateSet.sys_id}|${config.updateSet.name}> from ${ctx.config.host.name} to ${ctx.config.deploy.host.name}`);
                        });
                    }

                    return step(`deploying updateSet '${config.updateSet.sys_id}'  to '${ctx.config.deploy.host.name}'`).then(() => {
                        return slack.message(`Deploying Update-Set <${config.host.name}/sys_update_set.do?sys_id=${config.updateSet.sys_id}|${config.updateSet.name}> from ${ctx.config.host.name} to ${ctx.config.deploy.host.name}`);
                    }).then(() => {
                        return step(`deploying updateSet '${config.updateSet.sys_id}'  to '${ctx.config.deploy.host.name}'`);

                    }).then(() => { // deploy the update set
                        
                        return self.getClient(config).deployUpdateSet(config.updateSet.sys_id, ctx.config.deploy.host.name).catch((e) => {
                            if (409 == e.statusCode) { // validation issue
                                var result = e.error.result || {};
                                var error = result.error || {};
                                throw error;
                            } else {
                                throw e;
                            }
                        }).then(({ result, seconds }) => {
                            
                            return step(`UpdateSet successfully deployed in ${seconds} sec. Result: ${result}`).then(() => {                            
                                return slack.build.complete(`Update-Set <${config.host.name}/sys_update_set.do?sys_id=${config.updateSet.sys_id}|${config.updateSet.name}> committed on <${ctx.config.deploy.host.name}/sys_update_set.do?sys_id=${result.targetUpdateSetSysId}|${ctx.config.deploy.host.name}> within ${seconds} sec`);
                            });
                            
                        }).catch((e) => {
                            if (!e.updateSet)
                                throw e;

                            //console.error(e);

                            return Promise.try(() => {
                                return this.build.setProgress(ctx, this.build.DEPLOYMENT_MANUAL_INTERACTION);

                            }).then(() => {
                                return step(`Commit needs manual interaction!`, e);

                            }).then(() => {
                                var message = `${e.name}!\n${e.message}. <${e.updateSet}>`;
                                return slack.build.failed(message);
                            });
                        });
                    });                    
                }); 
                */
                // #endregion
            }
        }
    });

};