const Promise = require('bluebird');
const path = require("path");
const EventBusJob = require('../eb/job');

/**
 * Build has completed, called from GULP process
 * Mapped to: /build/complete
 *
 * This might trigger internally the deployment of the update-set
 *
 * @param {Object} param
 * @param {*} param.runId id of the current run
 * @param {*} param.buildResult the build results
 * @param {Console} logger a logger to be used
 * @param {Object} job job object 
 * @returns {Promise}
 */
module.exports = function ({runId, buildResult}, logger = console, {host}) {
    const self = this;
    let config = {};
    let run;
    var slack = self.getSlack();

    const step = (message, error) => {
        return self.addStep(logger, config, `${path.basename(__filename).split('.')[0]} : ${message}`, error);
    };

    return Promise.try(() => {
        return self.db.run.get(runId).then((_run) => {
            if (!_run)
                throw Error(`Run not found with id ${runId}`);
            run = _run;
            config = _run.config;
        });
    }).then(() => {
        /* 
            check if either one gulp task failed (run.buildResults[name])
            or if it failed at the end (buildResult[name].testPass)
        */
        const buildPass = Object.keys(run.build).every((name) => {
            if (run.build[name].enabled !== false && run.build[name].breakOnError === true) {
                return !(run.buildResults[name] === false || buildResult[name].testPass !== true);
            }
            return true;
        });
        run.buildPass = buildPass;
        return self.db.run.update(run);
    }).then(() => {
        if (!run.buildPass) {
            return self.setProgress(config, this.build.FAILED).then(() => {
                return slack.build.failed(`Build for <${config.application.docUri}|${config.updateSet.name}> did not pass!`);
            });
        }

        if (run.buildPass) {
            if (config.git.enabled && config.git.pullRequestEnabled) {
                return Promise.try(() => {
                    return step('raise pull request');
                }).then(() => {
                    return self.raisePullRequest({
                        config: config,
                        requestor: config.build.requestor.userName,
                        repoName: config.git.repository,
                        from: config.branchName,
                        to: config.master.name || 'master',
                        title: `${config.updateSet.name} (${config.build.requestor.fullName})`,
                        description: `${config.updateSet.description}\n\nBuild Results: ${config.application.docUri}\n\nCompleted-By: ${config.build.requestor.fullName} (${config.build.requestor.userName})\nCompleted-On: ${config.updateSet.sys_updated_on} UTC\n${config.host.name}/sys_update_set.do?sys_id=${config.updateSet.sys_id}`
                    });
                }).then(() => {
                    return self.db.us.findOne({ runId: run._id }).then((us) => {
                        if (us) {
                            us.pullRequestRaised = true;
                            return self.db.us.update(us);
                        }
                    });
                });
            } else if (config.deploy && config.deploy.enabled && config.deploy.onBuildPass) { // deploy the update set
                return new EventBusJob({ name: 'deployUpdateSet' }, { commitId: run.commitId }, logger);
            } else {
                return self.setProgress(config, this.build.COMPLETE).then(() => {
                    return slack.build.complete(`Build successfully completed for Update-Set <${config.host.name}/sys_update_set.do?sys_id=${config.updateSet.sys_id}|${config.updateSet.name}>\n<${config.application.docUri}|Build Results>`);
                });
            }
        }
    });
};