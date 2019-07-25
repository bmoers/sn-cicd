const Promise = require('bluebird');
const assign = require('object-assign-deep');
const path = require("path");
const uui = require('uuid/v4');

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
module.exports = function ({ id = uui().toLowerCase(), commitId, from, to, deploy, git }, logger = console, { host }) {
    const self = this;
    let config = {};
    let run;
    let deployment;
    let targetHostName;
    let targetInstanceName;
    let sourceHostName;
    let sourceInstanceName;
    let deployFromGit = Boolean(process.env.CICD_CD_DEPLOY_FROM_GIT === 'true');
    let normalBuildRun;
    const slack = self.getSlack();

    const step = (message, error) => {
        return self.addStep(logger, config, `${path.basename(__filename).split('.')[0]}.deployUpdateSet : ${message}`, error);
    };

    const getCdCredentials = (hostFQDN) => {
        const varName = `${((hostFQDN) ? `_${hostFQDN.toUpperCase()}` : '')}_USER`;
        const cdUsername = process.env[`CICD_CD${varName}_NAME`] || process.env.CICD_CD_USER_NAME || process.env[`CICD_CI${varName}_NAME`] || process.env.CICD_CI_USER_NAME;
        const cdPassword = process.env[`CICD_CD${varName}_PASSWORD`] || process.env.CICD_CD_USER_PASSWORD || process.env[`CICD_CI${varName}_PASSWORD`] || process.env.CICD_CI_USER_PASSWORD;
        return {
            username: cdUsername,
            password: cdPassword
        }
    };

    return self.db.deployment.findOne({
        _id: id
    }).then((deployment) => {
        if (!deployment)
            throw Error(`Deployment not found with id ${id}`);

        return self.db.run.findOne({
            _id: deployment.runId
        });

    }).then((_run) => {
        if (!_run)
            throw Error(`Build did not pass or run not found with commitId ${commitId}`);

        if (_run.buildPass !== true)
            throw Error(`Build did not pass. Can't deploy commit ${commitId}`);

        run = _run;
        config = run.config;

        sourceHostName = from;
        if (!sourceHostName)
            throw Error('DeployUpdateSet: No source host specified!');

        targetHostName = to;
        if (!targetHostName)
            throw Error('DeployUpdateSet: No target host specified!');

        if (git !== undefined)
            deployFromGit = Boolean(git);

        if (deployFromGit && !run.config.git.remoteUrl)
            throw Error(`GIT deployment not supported. Remote repository missing.`);

        normalBuildRun = (run.config.host.name == sourceHostName && config.deploy.host.name == targetHostName);

        const m1 = sourceHostName.match(/(?:http[s]?:\/\/)([^\.]*)([^:\/]*)/i);
        sourceInstanceName = (m1) ? m1[1] : sourceHostName;

        const m2 = targetHostName.match(/(?:http[s]?:\/\/)([^\.]*)([^:\/]*)/i);
        targetInstanceName = (m2) ? m2[1] : targetHostName;

        return self.db.deployment.findOne({
            _id: id
        }).then((_deployment) => {
            if (!_deployment)
                throw new Error('Deployment job not found');

            deployment = assign(_deployment, {
                to: targetHostName,
                from: sourceHostName,
                state: 'requested',
                start: Date.now(),
                end: -1,
                mode: (deployFromGit) ? 'GIT' : 'ServiceNow',
                type: deploy ? 'deploy' : 'deliver'
            });

            return self.db.deployment.update(deployment);

        });

    }).then(() => {
        return step(`complete update-set ${config.updateSet.name}`);

    }).then(() => {
        return self.setProgress(config, this.build.COMPLETE);

    }).then(() => {

        return Promise.try(() => {
            return step(`${deploy ? 'Deploying' : 'Delivering'} updateSet '${config.updateSet.sys_id}' to '${targetHostName}' ${deployFromGit ? 'via GIT' : ''}`);
        }).then(() => {
            return slack.message(`${deploy ? 'Deploying' : 'Delivering'} Update-Set <${sourceHostName}/sys_update_set.do?sys_id=${config.updateSet.sys_id}|${config.updateSet.name}> from ${sourceHostName} to ${targetHostName} ${deployFromGit ? 'via GIT' : ''}`);

        }).then(() => { // deploy the update set

            const client = self.getClient({ host: { name: sourceHostName } });

            const options = {
                targetHostName,
                targetAuth: getCdCredentials(targetInstanceName),
                sourceAuth: getCdCredentials(sourceInstanceName),
                deploy
            };

            if (deployFromGit) {
                options.commitId = deployment._id; // used to be deployment.commitId;
            } else {
                options.updateSetSysId = config.updateSet.sys_id;
            }



            return client.deployUpdateSet(options).then(({ result, seconds }) => {

                return Promise.try(() => {
                    if ((deploy && result.state == 'delivered') || (!deploy && result.state == 'committed'))
                        return slack.message(`WARNING: Job was to ${deploy ? 'deploy' : 'deliver'}, but US was ${result.state}`);
                }).then(() => {
                    return step(`UpdateSet successfully ${deploy ? 'deployed' : 'delivered'} in ${seconds} sec.`).then(() => {
                        return slack.build.complete(`Update-Set <${sourceHostName}/sys_update_set.do?sys_id=${config.updateSet.sys_id}|${config.updateSet.name}> ${deploy ? 'committed on' : 'delivered to'} <${targetHostName}/sys_remote_update_set.do?sys_id=${result.remoteUpdateSetSysId}|${targetHostName}> within ${seconds} sec`);
                    }).then(() => {
                        deployment.state = 'completed';
                    });
                })

            }).catch((e) => {

                if (e.updateSet)
                    return Promise.try(() => {
                        deployment.state = 'manual_interaction';
                        return step(`Commit needs manual interaction!`, e).then(() => {
                            return slack.build.failed(`${e.name}!\n${e.message}. <${e.updateSet}>`);
                        });
                    });

                deployment.state = 'failed';
                deployment.error = e.message;
                return slack.build.failed(`${e.name}!\n${e.message}. <${config.updateSet.name}>`).then(() => {
                    throw e;
                });

            }).finally(() => {
                deployment.end = Date.now();
                return self.db.deployment.update(deployment).then(() => {
                    if (!normalBuildRun)
                        return;

                    // in case this is a regular (normal) build, save th deployment id to the run
                    return self.db.run.findOne({
                        _id: deployment.runId
                    }).then((run) => {
                        if (run) {
                            run.deploymentId = deployment._id;
                            return self.db.run.update(run);
                        }
                    });

                })
            });
        });
    });
};


/*
        // legacy migrate deployments to separate container
        if (run.deploy) {
            return Promise.each(Object.keys(run.deploy), (deployTo) => {
                const deployment = run.deploy[deployTo];
                return self.db.deployment.insert({
                    runId: run._id,
                    id: uui().toLowerCase(),
                    usId: run.usId,
                    appId: run.appId,
                    commitId: run.commitId,
                    to: `https://${deployTo}.service-now.com`,
                    from: config.host.name,
                    state: deployment.state
                }).then(() => {
                    delete run.deploy[deployTo];
                });
            }).then(() => {
                delete run.deploy;
                return self.db.run.update(run);
            });
        }
        */
