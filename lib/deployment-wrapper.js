const EventBusJob = require('./eb/job');
const path = require("path");

/**
 * execute deployment
 * 
 */
module.exports.run = function ({ commitId, from, to, deploy, git }) {
    const self = this;
    let config = {};
    const slack = self.getSlack();

    const step = (message, error) => {
        return self.addStep(console, config, `${path.basename(__filename).split('.')[0]}.run : ${message}`, error);
    };

    if (!commitId)
        throw Error('CommitID is mandatory');

    return self.db.run.findOne({
        commitId
    }).then((run) => {
        if (!run)
            throw Error(`Run not found with commitId ${commitId}`);

        if (git && !run.config.git.remoteUrl)
            throw Error(`GIT deployment not supported. Remote repository missing.`);

        config = run.config;

        let sourceHostName = (from || run.config.host.name || '').toLowerCase().replace(/\/$/, "");
        if (!sourceHostName)
            throw Error('DeployUpdateSet: No source host specified!');

        sourceHostName = (!sourceHostName.startsWith('https://')) ? `https://${sourceHostName}` : sourceHostName;

        let targetHostName = (() => {
            if (to && to != 'undefined') {
                // allow to deploy to any host (via REST call)
                return to;
            } else if (process.env.CICD_CD_STRICT_DEPLOYMENT == 'true') {
                // deploy ony to the configured target environments
                const m = sourceHostName.match(/(?:http[s]?:\/\/)([^\.]*)([^:\/]*)/i);
                const sourceInstanceName = (m) ? m[1] : sourceHostName;
                return process.env[`CICD_CD_DEPLOYMENT_TARGET_${sourceInstanceName.toUpperCase()}`] || process.env.CICD_CD_DEPLOYMENT_TARGET || '';
            } else {
                return (run.config.deploy && run.config.deploy.host && run.config.deploy.host.name) ? run.config.deploy.host.name : '';
            }
        })().toLowerCase().replace(/\/$/, "");

        /*
            in case of no target specified or target == source, exit.
        */
        if (!(targetHostName)) {
            return self.setProgress(config, this.build.COMPLETE).then(() => {
                return step(`${deploy ? 'Deploy' : 'Deliver'} is disabled for this update-set`)
            }).then(() => {
                return slack.message(`Update-Set <${sourceHostName}/sys_update_set.do?sys_id=${config.updateSet.sys_id}|${config.updateSet.name}> needs to be ${deploy ? 'deployed' : 'delivered'} manually!`);
            });
        }
        if (!self.getClient(config).canDeploy(sourceHostName, targetHostName)) {
            return self.setProgress(config, this.build.COMPLETE).then(() => {
                return step(`${deploy ? 'Deployment' : 'Deliver'} not possible from '${sourceHostName}' to '${targetHostName}'`)
            }).then(() => {
                return slack.message(`${deploy ? 'Deployment' : 'Deliver'} not possible from '${sourceHostName}' to '${targetHostName}'. Update-Set <${sourceHostName}/sys_update_set.do?sys_id=${config.updateSet.sys_id}|${config.updateSet.name}> needs to be ${deploy ? 'deployed' : 'delivered'} manually!`);
            });
        }

        if (!targetHostName)
            throw Error('DeployUpdateSet: No target host specified!');

        targetHostName = (!targetHostName.startsWith('https://')) ? `https://${targetHostName}` : targetHostName;

        return self.db.deployment.findOne({
            commitId,
            on: targetHostName,
            state: 'requested'
        }).then((deployment) => {
            if (deployment)
                throw Error(`${deploy ? 'Deployment' : 'Deliver'} to '${targetHostName}' already in progress`);

        }).then(() => {

            return self.db.deployment.insert({
                runId: run._id,
                usId: run.usId,
                appId: run.appId,
                commitId: run.commitId,
                ts: Date.now()
            }).then((deployment) => {
                return new EventBusJob({ name: 'deployUpdateSet', background: true }, { id: deployment._id, commitId, from: sourceHostName, to: targetHostName, deploy, fromGit: git }).then(() => {
                    return { commitId, id: deployment._id };
                });
            });
        });

    });
};

/**
 * get deployment results
 *
 */
module.exports.get = function ({ commitId, id }) {
    const self = this;
    return self.db.run.findOne({
        commitId
    }).then((run) => {
        if (!run)
            throw Error(`Run not found with commitId ${commitId}`);

        return self.db.deployment.findOne({
            commitId,
            _id: id
        }).then((deployment) => {
            if (deployment && deployment.state != 'requested') {
                return deployment;
            }
            throw Error('304');
        });
    });
};