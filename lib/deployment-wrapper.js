const EventBusJob = require('./eb/job');
const EbQueueJob = require('./eb/queue-job');
const path = require("path");
const uui = require('uuid/v4');
/**
 * execute deployment
 * 
 */
module.exports.run = function ({ commitId, from, to, deploy, git }, logger = console) {
    const self = this;
    let config = {};
    let appId;
    const slack = self.getSlack();

    const step = (message, error) => {
        return self.addStep(logger, config, `${path.basename(__filename).split('.')[0]}.run : ${message}`, error);
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
        appId = run.appId;

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

        // check for valid deployment request, get its baseline commit Id, execute deployment
        return self.db.deployment.findOne({
            commitId,
            to: targetHostName,
            state: 'requested'
        }).then((deployment) => { // check there is no pending deployment of this commit Id and target host
            if (deployment)
                throw Error(`${deploy ? 'Deployment' : 'Deliver'} to '${targetHostName}' already in progress`);

        }).then(() => { // get the baseline CommitId: the last successful deployment to the target environment

            /*
                TODO: 
                - check if MERGE DEPLOYMENT is enabled (config.)
                - check if GIT is enabled


            */
            /*
                get the baseline information of the application
                - this allows to only deploy the update sets created since the last deployment
                find the latest deployment of this application to the targetHost.

            */
            return self.db.deployment.find({
                appId: run.appId,
                to: targetHostName,
                state: 'completed' // 'failed' or 'manual_interaction' will lead to a redeploy
            }).then((deployments) => {

                let baselineDeployment;
                let baselineCommitId;
                let baselineTs = -1;

                if (deployments.length) {
                    baselineDeployment = deployments.sort((a, b) => b.ts - a.ts)[0]; // sort desc, get latest commitId
                    baselineCommitId = baselineDeployment.commitId;
                    baselineTs = baselineDeployment.ts;
                }

                return self.db.run.find({ appId, merged: true, ts: { $gt: baselineTs } }).then((runs) => {

                    return runs.reduce((out, run) => {
                        const scopeName = run.config.updateSet.scopeName;
                        const artifact = run.config.build.artifact ? run.config.build.artifact : `us/${run.config.updateSet.scopeName}/sys_update_set_${run.config.updateSet.sys_id}.xml`;
                        const scope = out[scopeName];
                        if (scope) {
                            scope.commitIds.push(run.commitId);
                            scope.artifacts.push(artifact);
                        } else {
                            out[scopeName] = {
                                commitIds: [run.commitId],
                                artifacts: [artifact]
                            }
                        }
                        return out;
                    }, {});

                }).then((scopes) => {
                    return {
                        baselineCommitId,
                        baselineTs,
                        scopes
                    }
                });

            });


        }).then((deployments) => {


            const deploymentRuns = Object.keys(deployments.scopes).map((scopeName) => {

                const deploymentId = uui().toLowerCase().replace(/-/g, '');

                return self.db.deployment.insert({
                    _id: deploymentId,
                    state: 'requested',
                    runId: run._id,
                    usId: run.usId,
                    appId: run.appId,
                    commitId: run.commitId,

                    scopeName,
                    scope: deployments.scopes[scopeName],
                    baselineCommitId: deployments.baselineCommitId,
                    baselineTs: deployments.baselineTs,
                    ts: Date.now()
                }).then((deployment) => {
                    return new EventBusJob({ name: 'deployUpdateSet', background: true }, { id: deployment._id, commitId, from: sourceHostName, to: targetHostName, deploy, git }, logger).then(() => {
                        return { commitId, id: deployment._id };
                    });
                });
            })

            return Promise.all(deploymentRuns).then((out) => {
                return out;
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
