const Promise = require('bluebird');
const ExeJob = require('../eb/job');
const QueueJob = require('../eb/queue-job');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const assign = require('object-assign-deep');
const promiseFor = require('../ext/promise-for');


/**
 * execute deployment
 * 
 */
module.exports = async function ({ commitId, from, to, deploy, git = (process.env.CICD_CD_DEPLOY_FROM_GIT === 'true') }, logger = console, { host, exclusiveId }) {
    const self = this;
    const slack = self.getSlack();

    if (!exclusiveId)
        throw Error('No exclusiveId set! Deployments must run exclusively.');

    if (!commitId)
        throw Error('CommitID is mandatory');


    const run = await self.db.run.findOne({
        commitId
    });

    if (!run)
        throw Error(`Run not found with commitId ${commitId}`);

    if (run.config.git.pullRequestEnabled && !run.merged)
        throw Error('Run found, but pull request not merged!');

    if (git && !run.config.git.remoteUrl)
        throw Error('GIT deployment not supported. Remote repository missing.');


    const config = run.config;
    const appId = run.appId;

    const step = (message, error) => {
        return self.addStep(logger, config, `${path.basename(__filename).split('.')[0]}.run : ${message}`, error);
    };

    let sourceHostName = (from || run.config.host.name || '').toLowerCase().replace(/\/$/, '');
    if (!sourceHostName)
        throw Error('DeployUpdateSet: No source host specified!');

    sourceHostName = (!sourceHostName.startsWith('https://')) ? `https://${sourceHostName}` : sourceHostName;

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
    })().toLowerCase().replace(/\/$/, '');

    /*
        in case of no target specified or target == source, exit.
    */
    if (!(targetHostName)) {
        if(!git){
            await self.setProgress(config, this.build.COMPLETE);
        }
        await step(`${deploy ? 'Deploy' : 'Deliver'} not possible for this update-set. No target environment specified.`);
        await slack.message(`*${run.config.application.name} › ${run.config.updateSet.name} › #${run.sequence}*\nDEPLOYMENT - No target environment specified.\n\nUpdate-Set <${self.link(sourceHostName, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`)}|${config.updateSet.name}> needs to be ${deploy ? 'deployed' : 'delivered'} manually!\n\n<${run.config.application.docUri}|details>`);
        return;
    }
    if (!git && !self.getClient(config).canDeploy(sourceHostName, targetHostName)) { // via GIT, deployment to the same instance is possible
        await self.setProgress(config, this.build.COMPLETE);
        await step(`${deploy ? 'Deployment' : 'Deliver'} not possible from '${sourceHostName}' to '${targetHostName}'`);
        await slack.message(`*${run.config.application.name} › ${run.config.updateSet.name} › #${run.sequence}*\nDEPLOYMENT - Cant deploy to target.\n\n${deploy ? 'Deployment' : 'Deliver'} not possible from '${sourceHostName}' to '${targetHostName}'. Update-Set <${self.link(sourceHostName, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`)}|${config.updateSet.name}> needs to be ${deploy ? 'deployed' : 'delivered'} manually!\n\n<${run.config.application.docUri}|details>`);
        return;
    }

    if (!targetHostName)
        throw Error('DeployUpdateSet: No target host specified!');

    targetHostName = (!targetHostName.startsWith('https://')) ? `https://${targetHostName}` : targetHostName;

    // check for valid deployment request, get its baseline commit Id, execute deployment
    const deployment = await self.db.deployment.findOne({
        commitId,
        to: targetHostName,
        state: 'requested'
    });
    if (deployment)
        throw Error(`${deploy ? 'Deployment' : 'Deliver'} to '${targetHostName}' already in progress`);

    if (!git) {
        await step(`complete update-set ${config.updateSet.name}`);
        await self.setProgress(config, this.build.COMPLETE);
    }
    await self.setRunState(config, self.run.COMPLETED_DEPLOYMENT_IN_PROGRESS);

    /*
        get the baseline CommitId: the last successful deployment to the target environment
        - this allows to only deploy the update sets created since the last deployment find the latest deployment of this application to the targetHost.
    */

    let baselineCommitId;
    let baselineTs = -1;

    const reDeployment = await self.db.deployment.findOne({
        appId: run.appId,
        to: targetHostName,
        commitId
    });

    if (reDeployment) {
        baselineCommitId = reDeployment.baselineCommitId;
        baselineTs = reDeployment.baselineTs;
        console.log(`Redeployment ::  deployment ID: ${reDeployment._id}`);
    }

    let runs = [];
    if (!git) {
        console.log('Deployment Mode :: Single Update Set File');
        runs = [run];

    } else if (config.fixDeployment) {
        console.log('Deployment Mode :: Git - Fix deployment');
        runs = [run];

    } else if (!config.mergedDeployment) {
        console.log('Deployment Mode :: Git - Individual Deployment');
        runs = [run];

    } else {
        console.log('Deployment Mode :: Git - Merged Deployment');

        // lookup commitID of last 'successful' delivery/deployment
        if (!baselineCommitId) {

            if (reDeployment) {
                console.log('Redeployment :: baselineCommitId is empty. Recheck in prev runs for correct commitId ');
            }

            const prevRuns = await self.db.run.find({
                appId,
                merged: true,
                mergedTs: {
                    $lt: run.mergedTs
                }
            });
            const prevRunsCommitIds = [...new Set(prevRuns.map((r) => r.commitId))];

            console.log(`Prev Runs Commit ID's : ${prevRunsCommitIds.length}`);

            // sort desc, get latest commitId
            const baselineDeployment = await self.db.deployment.find({
                appId: run.appId,
                to: targetHostName,
                state: { $in: ['completed', 'missing_references', 'delivered'] }, // 'failed' or 'manual_interaction' will lead to a redeploy,
                commitId: { $in: prevRunsCommitIds },
                fix: { $in: [null, false] }
            }, (query) => query.sort({ ts: -1 }).limit(1)).then((d) => (d.length ? d[0] : undefined));

            if (baselineDeployment) {
                baselineCommitId = baselineDeployment.commitId;
                baselineTs = baselineDeployment.ts;

                console.log(`Baseline Deployment :: deployment ID: ${baselineDeployment._id}`);
            }
        }

        console.log(`Baseline Commit :: commitId: ${baselineCommitId}, baselineTs: ${baselineTs.toLocaleString()}`);

        // find all runs with a merged pull request since that baseline-timestamp
        runs = await self.db.run.find({
            appId,
            merged: true,
            $or: [
                { mergedTs: { $gt: baselineTs, $lte: run.mergedTs } },
                { _id: run._id }
            ]
        }, (query) => query.sort({ ts: 1 })); // sort ascending, last conflict resolution wins
    }

    const scopes = runs.reduce((out, redRun) => {
        const updateSet = redRun.config.updateSet;
        const scopeName = updateSet.scopeName;

        const artifactFile = redRun.config.build.artifact ? redRun.config.build.artifact : `us/${updateSet.scopeName}/sys_update_set_${updateSet.sys_id}.xml`;
        const artifact = {
            name: updateSet.name,
            file: artifactFile,
            commitId: redRun.commitId
        };

        const scope = out[scopeName];

        // collect all conflict resolutions since the last run
        // newer resolution will override older ones
        const conflictResolutions = (redRun.collision && redRun.collision.solution) ? redRun.collision.solution.resolutions : {};

        if (scope) {
            scope.artifacts.push(artifact);

            assign(scope.conflictResolutions, conflictResolutions);
            scope.updateSet = {
                name: updateSet.name,
                scopeId: updateSet.scopeId,
                appName: updateSet.appName,
                appVersion: updateSet.appVersion,
                description: updateSet.description
            };
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
            };
        }

        return out;
    }, {});

    //logger.log('commitId', commitId);
    //logger.log('DEPLOYMENTS');
    //logger.dir(deployments, { depth: null, colors: true });

    // all deployments for this app share the same groupId to lookup overall result later
    const groupId = uuidv4();

    // insert all deployment objects
    const deploymentScopes = Object.keys(scopes).map(async (scopeName) => {

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
            ts: run.mergedTs,
            sysId,
            scopeName,
            groupId,
            scope: scopes[scopeName],
            baselineCommitId: baselineCommitId,
            baselineTs: baselineTs,
            fix: config.fixDeployment || false
        });

    });

    // parallel initialize all deployments
    const deployments = await Promise.all(deploymentScopes);

    // sequentially start all deployments
    return Promise.mapSeries(deployments, (deploymentJob) => {
        return new ExeJob({ name: 'deployUpdateSet', background: true, exclusiveId: `deploy-${deploymentJob.scopeName}-${commitId}` }, { id: deploymentJob._id, commitId, from: sourceHostName, to: targetHostName, deploy, git }, logger).then((job) => {
            return { commitId, groupId, id: deploymentJob._id, jobId: job._id };
        });
    });

};
