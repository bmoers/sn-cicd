/* eslint-disable complexity */

const assign = require('object-assign-deep');
const path = require("path");
const { v4: uuidv4 } = require('uuid');

/**
 * Deploy an update-set to a target ServiceNow environment
 * @param {Object} opt deploy configuration
 * 
 * @param {String} opt.commitId the commit ID of the US to be deployed
 * @param {String} opt.id a unique key to track the progress
 * 
 * @param {String} opt.from source of the update set
 * @param {String} opt.to alternative target environment [default from initial request 'config.deploy.host.name']
 * @param {Boolean} opt.deploy deploy if true, deliver if false
 * @param {Boolean} opt.git deploy from GIT repo 
 * 
 * @param {console} logger provide a logger to be used in here 
 * 
 * @param {Object} jobConfig 
 * @param {String} jobConfig.host run this job on a specific host
 * 
 * @returns {Promise<void>}
 */
// eslint-disable-next-line no-unused-vars
module.exports = async function ({ id = uuidv4().toLowerCase(), commitId, from, to, deploy, git }, logger = console, { host }) {

    const self = this;
    const slack = self.getSlack();

    const step = (message, error) => {
        return self.addStep(logger, config, `${path.basename(__filename).split('.')[0]}.deployUpdateSet : ${message}`, error);
    };

    const sourceHostName = from;
    const targetHostName = to;
    const deployFromGit = (git !== undefined) ? Boolean(git) : Boolean(process.env.CICD_CD_DEPLOY_FROM_GIT === 'true');

    let deployment = await self.db.deployment.findOne({ _id: id });
    if (!deployment)
        throw Error(`Deployment not found with id ${id}`);

    let config = {};
    let run;

    try {

        run = await self.db.run.findOne({ _id: deployment.runId });
        if (!run)
            throw Error(`Build did not pass or run not found with commitId ${commitId}`);

        config = run.config;

        const sourceInstanceName = self.getSubdomain(sourceHostName);
        const targetInstanceName = self.getSubdomain(targetHostName);

        deployment = assign(deployment, {
            to: targetHostName,
            from: sourceHostName,
            state: 'requested',
            start: Date.now(),
            end: -1,
            mode: (deployFromGit) ? 'GIT' : 'ServiceNow',
            type: deploy ? 'deploy' : 'deliver'
        });

        const runUpdateSet = config.updateSet; // the update set on which the build run was triggered
        const updateSet = deployment.scope.updateSet || runUpdateSet;

        const docUri = config.application.docUri;
        const gitRepoUrl = (config.git.url) ? config.git.url : false;

        const deploymentDate = `${new Date(deployment.start).toISOString().replace('T', ' ').substr(0, 19)} UTC`;
        const deploymentSequence = (deployment.sequence == undefined) ? 1 : deployment.sequence;

        const appName = updateSet.appName;
        const appVersion = updateSet.appVersion;

        // eslint-disable-next-line no-unused-vars
        const commitIdShort = run.commitId.substr(0, 7);
        const mergedDeployment = (run.config.mergedDeployment) ? true : false;

        let description = `${mergedDeployment ? 'Merged Update Set Deployment -- ' : ''} ${(deployment.type == 'deploy') ? 'Installed' : 'Delivered'} via CICD -- Provisioned via ${deployment.mode}\n`;

        if (deployment.type == 'deliver') {
            description += `\n** Requires to be committed manually **\n`;
        }

        description += `\nRequested at ${deploymentDate}\n`
        description += `Based on Commit ID\n\t${run.commitId} \n`;
        description += `Build Results\n\t${docUri} \n`;
        if (gitRepoUrl) {
            description += `Git Repository\n\t${gitRepoUrl} \n`;
        }

        if (mergedDeployment) {
            let artifactTxt = '';
            // check if the name is in the artifacts list (new version)
            if (deployment.scope.artifacts.some((a) => a.name)) {
                artifactTxt = deployment.scope.artifacts.map((a) => {
                    return `\t${a.name}\n\t\t#${a.commitId.substr(0, 7)} - ${a.file}`
                }).join('\n');
            } else { // fall back to old version with no 'name' argument
                artifactTxt = deployment.scope.commitIds.map((commitId, index) => {
                    return `\t#${commitId.substr(0, 7)}} - ${deployment.scope.artifacts[index]}`
                }).join('\n');
            }
            description += `Included artifacts\n${artifactTxt}\n`;
        }

        // append the original description 
        if (updateSet.description) {
            description += `- - - - - - - - \n`;
            description += `${updateSet.description}`
        }

        if (mergedDeployment && deployFromGit) {
            // the default update set name is `name version - #deployment-sequence` e.g. 'Incident 1.2 - #18'
            deployment.name = `${(updateSet.appVersion != "0") ? `${appName} ${appVersion}` : appName} - #${deploymentSequence}`;
        } else {
            // append the deployment-sequence to the name
            deployment.name = `${updateSet.name} : ${deploymentSequence}`;
        }

        deployment.description = description;
        const deploymentName = (deployment.name) ? `${run.config.updateSet.name} (${deployment.name} )` : run.config.updateSet.name;

        if (run.buildPass !== true)
            throw Error(`Build did not pass. Can't deploy commit ${commitId}`);

        if (!sourceHostName)
            throw Error('DeployUpdateSet: No source host specified!');

        if (!targetHostName)
            throw Error('DeployUpdateSet: No target host specified!');

        if (deployFromGit && !config.git.remoteUrl)
            throw Error(`GIT deployment not supported. Remote repository missing.`);

        deployment = await self.db.deployment.update(deployment);

        

        await step(`${deploy ? 'Deploying' : 'Delivering'} ${deployment.scope.artifacts.length} commits in scope '${deployment.scopeName}' to '${targetHostName}' ${deployFromGit ? 'via GIT' : ''}`);
        await slack.build.start(`*${run.config.application.name} › ${deploymentName} › #${run.sequence}*\nDEPLOYMENT - In progress.\n\n${deploy ? 'Deploying' : 'Delivering'} ${deployment.scope.artifacts.length ? `${deployment.scope.artifacts.length} commits` : 'one commit'} in scope '${deployment.scopeName}' from <${sourceHostName}|${sourceHostName}> to <${targetHostName}|${targetHostName}> ${deployFromGit ? 'via GIT' : ''}\n\n<${run.config.application.docUri}|details>`);


        const client = self.getClient({ host: { name: sourceHostName } });

        const options = {
            targetHostName,
            targetAuth: self.getCdCredentials(targetInstanceName),
            sourceAuth: self.getCdCredentials(sourceInstanceName),
            deploy,
            conflictResolutions: deployment.scope.conflictResolutions || {}
        };

        if (deployFromGit) {
            options.commitId = deployment._id; // used to be deployment.commitId;
            options.updateSetSysId = deployment.sysId; // unique over (#commitId, scopeName)
        } else {
            options.updateSetSysId = config.updateSet.sys_id;
        }

        let result, seconds;
        try {
            ({ result, seconds } = await client.deployUpdateSet(options));
        } catch (e) {
            // if there is no update-set object escalate
            if (!e.updateSet)
                throw e

            // the update set needs manual interaction
            deployment.state = 'manual_interaction';
            deployment.remoteUpdateSetID = (e.payload) ? e.payload.remoteUpdateSetSysId : undefined;
            deployment.hasCollisions = true;
            deployment.remoteUpdateSetUrl = self.link(targetHostName, `/sys_remote_update_set.do?sys_id=${deployment.remoteUpdateSetID}&sysparm_view=cicd_problems`);
            deployment.issues = [];

            if (e.dataLossWarnings.length)
                deployment.issues = deployment.issues.concat(e.dataLossWarnings);
            if (e.previewProblems.length)
                deployment.issues = deployment.issues.concat(e.previewProblems);

            await step(`Commit requires manual interaction!`, e);
            await slack.build.failed(`*${run.config.application.name} › ${deploymentName} › #${run.sequence}*\nDEPLOYMENT - Manual interaction required.\n\nDeployment of <${self.link(sourceHostName, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`)}|${config.updateSet.name}> requires manual interaction:\nCause: ${e.name}\nMessage: ${e.message}\n<${e.updateSet}>\n\n<${run.config.application.docUri}|details>`);
            const requestor = config.build.requestor;
            await self.email.onDeploymentConflicts({
                recipient: `"${requestor.fullName}" <${requestor.email}>`,
                data: {
                    sequence: run.sequence,

                    name: deployment.name,
                    scopeName: deployment.scopeName,
                    appName: deployment.scope.updateSet.appName,

                    sourceHostName,
                    sourceUpdateSetName: config.updateSet.name,
                    sourceUpdateSetID: config.updateSet.sys_id,
                    sourceUpdateSetUrl: self.link(sourceHostName, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`),

                    targetHostName,
                    remoteUpdateSetID: deployment.remoteUpdateSetID,
                    remoteUpdateSetUrl: deployment.remoteUpdateSetUrl,
                    previewProblems: e.previewProblems,
                    dataLossWarnings: e.dataLossWarnings
                }
            });

            return;
        }

        //logger.log('Deployment Result: ', seconds)
        //logger.dir(result, { depth: null, colors: true });

        /*
            all fine so far with the deployment
        */
        deployment.state = 'completed';
        deployment.remoteUpdateSetID = result.remoteUpdateSetSysId;
        deployment.hasCollisions = false;
        deployment.remoteUpdateSetUrl = self.link(targetHostName, `/sys_remote_update_set.do?sys_id=${deployment.remoteUpdateSetID}&sysparm_view=cicd_problems`);
        deployment.issues = [];
        // in case any of the committed records has a reference to a missing record (e.g. data source to mid server)
        deployment.missingRecords = result.missingRecords || {}

        if (result.deliveryConflicts) {
            const dataLossWarnings = result.deliveryConflicts.dataLossWarnings;
            const previewProblems = result.deliveryConflicts.previewProblems;
            if (dataLossWarnings.length)
                deployment.issues = deployment.issues.concat(dataLossWarnings);

            if (previewProblems.length)
                deployment.issues = deployment.issues.concat(previewProblems);
        }
        // TODO
        if ((deploy && result.state == 'delivered') || (!deploy && result.state == 'committed'))
            await slack.build.failed(`*${run.config.application.name} › ${deploymentName} › #${run.sequence}*\nDEPLOYMENT - ERROR.\n\nWARNING: Job was to ${deploy ? 'deploy' : 'deliver'}, but update set was ${result.state}\n\n<${run.config.application.docUri}|details>`);

        /*
            end here if the update set has no missing references
        */
        if (Object.keys(deployment.missingRecords).length == 0) {
            await step(`UpdateSet successfully ${deploy ? 'deployed' : 'delivered'} in ${seconds} sec.`);
            await slack.build.complete(`*${run.config.application.name} › ${deploymentName} › #${run.sequence}*\nDEPLOYMENT - Completed.\n\nUpdate-Set <${self.link(sourceHostName, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`)}|${config.updateSet.name}> ${deploy ? 'committed on' : 'delivered to'} <${self.link(targetHostName, `/sys_remote_update_set.do?sys_id=${result.remoteUpdateSetSysId}`)}|${targetHostName}> within ${seconds} sec\n\n<${run.config.application.docUri}|details>`);

            return;
        }

        /*
            inform about the issues
        */
        deployment.state = 'missing_references';
        const missingRecords = Object.keys(deployment.missingRecords).map((updateName) => {
            return `- <${deployment.missingRecords[updateName].link}|${updateName}> _"${deployment.missingRecords[updateName].description}"_`;
        }).join('\n');

        await step(`Some changes have missing records! UpdateSet ${deploy ? 'deployed' : 'delivered'} in ${seconds} sec.`);
        await slack.build.warning(`*${run.config.application.name} › ${deploymentName} › #${run.sequence}*\nDEPLOYMENT - Completed with missing references!\n\nThis deployment requires manual actions due to missing references in following changes:\n${missingRecords}\n\nUpdate-Set <${self.link(sourceHostName, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`)}|${config.updateSet.name}> ${deploy ? 'committed on' : 'delivered to'} <${self.link(targetHostName, `/sys_remote_update_set.do?sys_id=${result.remoteUpdateSetSysId}`)}|${targetHostName}> within ${seconds} sec\n\n<${run.config.application.docUri}|details>`);

        const requestor = config.build.requestor;

        return self.email.onDeploymentHasMissingRecords({
            recipient: `"${requestor.fullName}" <${requestor.email}>`,
            data: {
                sequence: run.sequence,

                name: deployment.name,
                scopeName: deployment.scopeName,
                appName: deployment.scope.updateSet.appName,

                sourceHostName,
                sourceUpdateSetName: config.updateSet.name,
                sourceUpdateSetID: config.updateSet.sys_id,
                sourceUpdateSetUrl: self.link(sourceHostName, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`),

                targetHostName,
                remoteUpdateSetID: deployment.remoteUpdateSetID,
                remoteUpdateSetUrl: deployment.remoteUpdateSetUrl,
                missingRecords: deployment.missingRecords
            }
        });

    } catch (e) {

        if (!deployment || !run)
            return;

        deployment.state = 'failed';
        deployment.error = e.message;

        const deploymentName = (deployment.name) ? `${run.config.updateSet.name} (${deployment.name} )` : run.config.updateSet.name;

        await slack.build.failed(`*${run.config.application.name} › ${deploymentName} › #${run.sequence}*\nERROR!\n\n${e.name}!\n${e.message}. <${config.updateSet.name}>\n\n<${run.config.application.docUri}|details>`)

        const requestor = config.build.requestor;
        await self.email.onDeploymentFailure({
            recipient: `"${requestor.fullName}" <${requestor.email}>`,
            data: {
                errorName: e.name,
                errorMessage: e.message,
                sequence: run.sequence,

                name: deployment.name,
                scopeName: deployment.scopeName,
                appName: deployment.scope.updateSet.appName,

                sourceHostName,
                sourceUpdateSetName: config.updateSet.name,
                sourceUpdateSetID: config.updateSet.sys_id,
                sourceUpdateSetUrl: self.link(sourceHostName, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`),
                targetHostName
            }
        });

        // escalate to caller
        throw e;

    } finally {

        deployment.end = Date.now();
        deployment = await self.db.deployment.update(deployment);
        /*
            set the run state
            - check for parallel deployments (multi scope per app)
            - nly 
        */
        const { runId, usId, appId, commitId, groupId } = deployment;
        const query = (groupId) ? { groupId } : { runId, usId, appId, commitId };


        const deployments = await self.db.deployment.find(query) || [];
        console.log('All deployments for ', runId, usId, appId, commitId)


        if (deployments.some((d) => d.state == 'failed')) {
            // at least one deployment failed
            await self.setRunState(config, self.run.COMPLETED_DEPLOYMENT_FAILED);

        } else if (deployments.some((d) => d.state == 'manual_interaction')) {
            // at least one deployment needs manual interaction
            await self.setRunState(config, self.run.COMPLETED_DEPLOYMENT_MANUAL_ACTION);

        } else if (deployments.every((d) => d.state == 'completed')) {
            // all deployments completed
            await self.setRunState(config, self.run.COMPLETED_DEPLOYMENT_COMPLETED);

        } else {
            await self.setRunState(config, self.run.COMPLETED_DEPLOYMENT_FAILED);
        }

        const normalBuildRun = (config.host.name == sourceHostName && config.deploy.host.name == targetHostName);
        if (normalBuildRun) {
            // in case this is a regular (normal) build, save th deployment id to the run
            const run = await self.db.run.findOne({
                _id: deployment.runId
            });
            if (run) {
                run.deploymentId = deployment._id;
                await self.db.run.update(run);
            }
        }
    }

};
