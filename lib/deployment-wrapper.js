const Promise = require('bluebird');
const EventBusJob = require('./eb/job');
const EbQueueJob = require('./eb/queue-job');
const path = require("path");
const { v4: uuidv4 } = require('uuid');
const assign = require('object-assign-deep');
const promiseFor = require('./ext/promise-for');
const randomInt = require('./ext/random-int');

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
    }).then(async (run) => {
        if (!run)
            throw Error(`Run not found with commitId ${commitId}`);

        if (git && !run.config.git.remoteUrl)
            throw Error(`GIT deployment not supported. Remote repository missing.`);

        config = run.config;
        appId = run.appId;

        /* mutual exclusive from here on
            make sure that the promiseFor() loop below is never called in parallel
            if multiple deployments are fired against the same application a the same time
        */
        await self.mutex.acquire(appId);

        let sourceHostName = (from || run.config.host.name || '').toLowerCase().replace(/\/$/, "");
        if (!sourceHostName)
            throw Error('DeployUpdateSet: No source host specified!');

        sourceHostName = (!sourceHostName.startsWith('https://')) ? `https://${sourceHostName}` : sourceHostName;

        /*
            ensure there is only one concurrent deployment
            -> multiple parallel deployment will cause issues during the update set merge phase and cause re-deployments
        */
        let elapsedSeconds = 0;
        const maxCheckSeconds = 4 * 60 * 60;   // max check for 4 hrs
        const delaySeconds = 30;               // every 30 sec

        await promiseFor(({ loop }) => loop, ({ appId }) => {

            console.log(`check for other deployments on the same '${config.application.name}' app`);

            return self.db.deployment.find({
                appId,
                state: { $in: ['requested'] } // 'canceled', 'failed', 'manual_interaction', 'missing_references', 'completed'
            }).then(async (deployments) => {

                if (deployments.length) {

                    if(elapsedSeconds == 0){
                        await slack.build.warning(`*${run.config.application.name} › ${run.config.updateSet.name} › #${run.sequence}*\nDEPLOYMENT - Delayed due to a parallel deployment on the same App.\n\nUpdate-Set <${self.link(sourceHostName, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`)}|${config.updateSet.name}> is queued and will be ${deploy ? 'deployed' : 'delivered'} soon.\n\n<${run.config.application.docUri}|details>`);
                    }

                    elapsedSeconds += delaySeconds;
                    if (elapsedSeconds > maxCheckSeconds){
                        await slack.build.failed(`*${run.config.application.name} › ${run.config.updateSet.name} › #${run.sequence}*\nDEPLOYMENT FAILED - Failed due to a parallel deployment still in progress.\n\nUpdate-Set <${self.link(sourceHostName, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`)}|${config.updateSet.name}> failed to be ${deploy ? 'deployed' : 'delivered'}.\nAnother '${deploy ? 'deployment' : 'delivery'}' job of the same application is still in progress and did not finish within ${maxCheckSeconds} sec.\n\n<${run.config.application.docUri}|details>`);

                        throw Error(`Another parallel '${deploy ? 'deployment' : 'delivery'}' job is already in progress and did not finish within ${maxCheckSeconds} sec`);
                    }
                    await step(`${deployments.length} other '${deploy ? 'deployment' : 'delivery'}' job already in progress`);

                    console.log(`... waiting for ${delaySeconds} sec and check again`);
                    await Promise.delay(delaySeconds * 1000);
                    return { loop: true, appId };
                }

                await step(`No other '${deploy ? 'deployment' : 'delivery'}' in progress, proceeding with deployment.`);
                if(elapsedSeconds > 0){
                    await slack.build.info(`*${run.config.application.name} › ${run.config.updateSet.name} › #${run.sequence}*\nDEPLOYMENT - Parallel deployment completed.\n\nUpdate-Set <${self.link(sourceHostName, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`)}|${config.updateSet.name}> is going to be ${deploy ? 'deployed' : 'delivered'} now.\n\n<${run.config.application.docUri}|details>`);
                }
                
                return { loop: false, appId };
            });
        }, { loop: true, appId });

        let targetHostName = (() => {
            const configTarget = (run.config.deploy && run.config.deploy.host && run.config.deploy.host.name) ? run.config.deploy.host.name : null;
            if (to && to != 'undefined') {
                // allow to deploy to any host (via REST call)
                return to;
            } else if (process.env.CICD_CD_STRICT_DEPLOYMENT == 'true' || configTarget === null) {
                // deploy ony to the configured target environments
                const sourceInstanceName = self.getSubdomain(sourceHostName);
                return process.env[`CICD_CD_DEPLOYMENT_TARGET_${sourceInstanceName.toUpperCase()}`] || process.env.CICD_CD_DEPLOYMENT_TARGET || '';
            } else {
                return configTarget;
            }
        })().toLowerCase().replace(/\/$/, "");

        /*
            in case of no target specified or target == source, exit.
        */
        if (!(targetHostName)) {
            return self.setProgress(config, this.build.COMPLETE).then(() => {
                return step(`${deploy ? 'Deploy' : 'Deliver'} is disabled for this update-set`)
            }).then(() => {
                return slack.message(`*${run.config.application.name} › ${run.config.updateSet.name} › #${run.sequence}*\nDEPLOYMENT - No target environment specified.\n\nUpdate-Set <${self.link(sourceHostName, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`)}|${config.updateSet.name}> needs to be ${deploy ? 'deployed' : 'delivered'} manually!\n\n<${run.config.application.docUri}|details>`);
            });
        }
        if (!self.getClient(config).canDeploy(sourceHostName, targetHostName)) {
            return self.setProgress(config, this.build.COMPLETE).then(() => {
                return step(`${deploy ? 'Deployment' : 'Deliver'} not possible from '${sourceHostName}' to '${targetHostName}'`)
            }).then(() => {
                return slack.message(`*${run.config.application.name} › ${run.config.updateSet.name} › #${run.sequence}*\nDEPLOYMENT - Cant deploy to target.\n\n${deploy ? 'Deployment' : 'Deliver'} not possible from '${sourceHostName}' to '${targetHostName}'. Update-Set <${self.link(sourceHostName, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`)}|${config.updateSet.name}> needs to be ${deploy ? 'deployed' : 'delivered'} manually!\n\n<${run.config.application.docUri}|details>`);
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
        }).then((deployment) => { // check there is no parallel deployment of this commit Id and target host
            if (deployment)
                throw Error(`${deploy ? 'Deployment' : 'Deliver'} to '${targetHostName}' already in progress`);

        }).then(() => {
            return step(`complete update-set ${config.updateSet.name}`);

        }).then(() => {
            return self.setProgress(config, this.build.COMPLETE);
        }).then(() => {
            return self.setRunState(config, self.run.COMPLETED_DEPLOYMENT_IN_PROGRESS);

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
                state: { $in: ['completed', 'missing_references', 'delivered'] } // 'failed' or 'manual_interaction' will lead to a redeploy
            }).then((deployments) => {

                let baselineDeployment;
                let baselineCommitId;
                let baselineTs = -1;

                if (deployments.length) {
                    // sort desc, get latest commitId
                    baselineDeployment = deployments.sort((a, b) => b.ts - a.ts)[0];
                    baselineCommitId = baselineDeployment.commitId;
                    baselineTs = baselineDeployment.ts;
                } else {
                    //baselineCommitId = commitId;
                }

                // find all runs with a merged pull request since that baseline-timestamp
                return self.db.run.find({ appId, merged: true, $or: [{ ts: { $gt: baselineTs } }, { _id: run._id }], }).then((runs) => {
                    // sort ascending, last conflict resolution wins
                    return runs.sort((a, b) => a.ts - b.ts).reduce((out, run, index, arr) => {
                        const updateSet = run.config.updateSet;
                        const scopeName = updateSet.scopeName;
                        const artifactFile = run.config.build.artifact ? run.config.build.artifact : `us/${updateSet.scopeName}/sys_update_set_${updateSet.sys_id}.xml`;
                        const artifact = {
                            name: updateSet.name,
                            file : artifactFile,
                            commitId: run.commitId
                        }
                        const scope = out[scopeName];

                        // collect all conflict resolutions since the last run
                        // newer resolution will override older ones
                        const conflictResolutions = (run.collision && run.collision.solution) ? run.collision.solution.resolutions : {}
                        if (scope) {
                            scope.artifacts.push(artifact);

                            assign(scope.conflictResolutions, conflictResolutions);
                            scope.updateSet = {
                                name: updateSet.name,
                                scopeId: updateSet.scopeId,
                                appName: updateSet.appName,
                                appVersion: updateSet.appVersion,
                                description: updateSet.description
                            }
                        } else {
                            out[scopeName] = {
                                artifacts: [artifact],
                                conflictResolutions: conflictResolutions,
                                updateSet: {
                                    name: updateSet.name,
                                    scopeId: updateSet.scopeId,
                                    appName: updateSet.appName,
                                    appVersion: updateSet.appVersion,
                                    description: updateSet.description
                                }
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

            //logger.log('commitId', commitId);
            //logger.log('DEPLOYMENTS');
            //logger.dir(deployments, { depth: null, colors: true });

            // all deployments for this app share the same groupId to lookup overall result later
            const groupId = uuidv4();

            // insert all deployment objects
            const deploymentScopes = Object.keys(deployments.scopes).map(async (scopeName) => {
               
                /* 
                   the same commit / scope combination must always result in the same sysId
                   as we can have multiple deployments:
                    the application entity container allows to be multi-scoped, we must run multiple deployments for the same commit id.
                    so for every scope, there must be a unique id based on the scope + commit id
                */
                const sysId = require('crypto').createHash('md5').update(scopeName.concat(run.commitId)).digest('hex');

                // increase the sequence
                const lastDeployment = await self.db.deployment.find({ appId: run.appId }, (query) => query.sort({ ts: -1 }).limit(1));
                const sequence = (lastDeployment.length == 0) ? 1 : (lastDeployment[0].sequence || 0) + 1;

                return self.db.deployment.insert({
                    state: 'requested',
                    runId: run._id,
                    sequence: sequence,
                    usId: run.usId,
                    appId: run.appId,
                    commitId: run.commitId,
                    sysId,
                    scopeName,
                    groupId,
                    scope: deployments.scopes[scopeName],
                    baselineCommitId: deployments.baselineCommitId,
                    baselineTs: deployments.baselineTs,
                    ts: Date.now()
                });
            });

            // parallel initialize all deployments
            return Promise.all(deploymentScopes).then((deploymentArray) => {
                // sequentially start all deployments
                return Promise.mapSeries(deploymentArray, (deployment) => {
                    
                    return new EventBusJob({ name: 'deployUpdateSet', background: true }, { id: deployment._id, commitId, from: sourceHostName, to: targetHostName, deploy, git }, logger).then(() => {
                        return { commitId, id: deployment._id };
                    });
                    
                }).then((out) => {
                    // release the lock so other deployment processes on the same app can proceed
                    self.mutex.release(appId);
                    return out;
                })
            });

        });

    }).catch((e)=>{
        // ensure the lock is always released
        self.mutex.release(appId);
        throw e;
    });
};

/**
 * get deployment results
 *
 */
module.exports.get = function ({ commitId, ids }) {
    const self = this;
    return self.db.run.findOne({
        commitId
    }).then((run) => {
        if (!run)
            throw Error(`Run not found with commitId ${commitId}`);

        return self.db.deployment.find({
            commitId,
            _id: { $in: ids.split(',') }
        }).then((deployments) => {
            // deployments completed or failed
            if (!deployments || deployments.length == 0)
                throw Error(`No deployment found with ID's ${ids}`);

            //console.log('Deployment result ', deployments);

            // all deployments processed (completed or failed)
            if (deployments.every((deployment) => (deployment.state != 'requested'))) {
                if (deployments.every((deployment) => (deployment.state == 'completed'))) {
                    return { state: 'completed', deployments };
                } else {
                    console.error("Some deployment failed", deployments);
                    throw deployments
                }
            }
            throw Error('304');
        });
    });
};
