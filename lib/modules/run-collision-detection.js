
const Promise = require('bluebird');
const path = require("path");
const EventBusJob = require('../eb/job');

/**
 * @param {*} runId id of the current run
 * @param {Console} logger a logger to be used
 * @param {Object} job job object 
 * @returns {Promise}
 */
module.exports = function (runId, logger = console, { host }) {
    const self = this;
    const slack = self.getSlack();
    let config = {};
    let run = {};

    const step = (message, error) => {
        return self.addStep(logger, config, `${path.basename(__filename).split('.')[0]} : ${message}`, error);
    };

    return Promise.try(() => {
        return self.db.run.get(runId);
    }).then((_run) => {
        if (!_run)
            throw Error(`Run not found with id ${runId}`);

        run = _run;
        config = run.config;

        if (!run.config.build.collisionDetection)
            return step(`** Conflict detection disabled **`);

        if (run.collision.state == 'passed') {
            return step(`Conflict check passed.`);
        }


        return Promise.try(() => {
            return self.setRunState(run, self.run.CONFLICT_DETECTION);

        }).then(() => {
            run.collision.state = 'running';
            return self.db.run.update(run);

        }).then(() => {

            let sourceHostName = (run.config.host.name || '').toLowerCase().replace(/\/$/, "");
            if (!sourceHostName)
                throw Error('DeployUpdateSet: No source host specified!');

            sourceHostName = (!sourceHostName.startsWith('https://')) ? `https://${sourceHostName}` : sourceHostName;

            let targetHostName = (() => {
                if (process.env.CICD_CD_STRICT_DEPLOYMENT == 'true') {
                    // deploy ony to the configured target environments
                    const m = sourceHostName.match(/(?:http[s]?:\/\/)([^\.]*)([^:\/]*)/i);
                    const sourceInstanceName = (m) ? m[1] : sourceHostName;
                    return process.env[`CICD_CD_DEPLOYMENT_TARGET_${sourceInstanceName.toUpperCase()}`] || process.env.CICD_CD_DEPLOYMENT_TARGET || '';
                } else {
                    return (run.config.deploy && run.config.deploy.host && run.config.deploy.host.name) ? run.config.deploy.host.name : '';
                }
            })().toLowerCase().replace(/\/$/, "");
            if (!targetHostName)
                throw Error('DeployUpdateSet: No target host specified!');

            targetHostName = (!targetHostName.startsWith('https://')) ? `https://${targetHostName}` : targetHostName;

            const m1 = sourceHostName.match(/(?:http[s]?:\/\/)([^\.]*)([^:\/]*)/i);
            const sourceInstanceName = (m1) ? m1[1] : sourceHostName;

            const m2 = targetHostName.match(/(?:http[s]?:\/\/)([^\.]*)([^:\/]*)/i);
            const targetInstanceName = (m2) ? m2[1] : targetHostName;


            const client = self.getClient({ host: { name: sourceHostName } });
            const options = {
                targetHostName,
                targetAuth: self.getCdCredentials(targetInstanceName),
                sourceAuth: self.getCdCredentials(sourceInstanceName),
                updateSetSysId: run.config.updateSet.sys_id
            };

            return Promise.try(() => {
                return step(`Running conflicts check. Delivering update set to ${targetHostName} to check for conflicts.`);
            }).then(() => {
                // update set needs to be set to complete to be able to deliver it
                return self.setProgress(config, self.build.COMPLETE);
            }).then(() => {
                return client.collDetectUpdateSet(options);
            }).then(({ result, seconds }) => {

                return Promise.try(() => {
                    return self.setRunState(run, self.run.CONFLICT_PASSED);
                }).then(() => {
                    run.collision.state = 'passed';
                    run.collision.hasCollisions = false;
                    run.collision.remoteUpdateSetID = result.remoteUpdateSetSysId;
                    run.collision.remoteUpdateSetUrl = self.link(targetHostName, `/sys_remote_update_set.do?sys_id=${run.collision.remoteUpdateSetID}&sysparm_view=cicd_preview`);
                    return self.db.run.update(run);
                }).then(() => {
                    return self.setProgress(config, self.build.COLLISION_REVIEW_PASSED);
                });

            }).catch((e) => {

                return Promise.try(() => {
                    return self.setRunState(run, self.run.CONFLICT);
                }).then(() => {
                    run.collision.state = 'failed';
                    run.collision.hasCollisions = true;
                    run.collision.remoteUpdateSetID = (e.payload) ? e.payload.remoteUpdateSetSysId : undefined;
                    run.collision.remoteUpdateSetUrl = self.link(targetHostName, `/sys_remote_update_set.do?sys_id=${run.collision.remoteUpdateSetID}&sysparm_view=cicd_preview`);
                    if (e.updateSet) {
                        if (e.previewProblems.length)
                            run.collision.issues = run.collision.issues.concat(e.previewProblems);
                        if (e.dataLossWarnings.length)
                            run.collision.issues = run.collision.issues.concat(e.dataLossWarnings);
                    }
                    return self.db.run.update(run);
                }).then(() => {
                    return self.setProgress(config, self.build.COLLISION_REVIEW_PENDING);
                }).then(() => {
                    //return step('Conflict Detection error', e);
                }).then(() => {
                    if (e.updateSet) {
                        //console.warn('Preview requires manual interaction!', e);

                        return step(`Preview requires manual interaction!`).then(() => {

                            return slack.build.warning(`*${run.config.application.name} › ${run.config.updateSet.name} › #${run.sequence}*\nPREFLIGHT CONFLICTS - Update Set is causing conflicts.\n\nPreview of <${self.link(sourceHostName, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`)}|${config.updateSet.name}> requires manual interaction. \nPlease open the <${run.collision.remoteUpdateSetUrl}|Preview Update Set> and resolve conflicts manually to proceed with this CICD run.\n\n<${run.config.application.docUri}|details>`);

                        }).then(() => {

                            const requestor = config.build.requestor;

                            return self.email.onPreviewConflicts({
                                recipient: `"${requestor.fullName}" <${requestor.email}>`,
                                data: {
                                    sequence: run.sequence,
                                    sourceHostName,
                                    sourceUpdateSetName: config.updateSet.name, //'[CICD PREFLIGHT] - '.concat(config.updateSet.name),
                                    sourceUpdateSetID: config.updateSet.sys_id,
                                    sourceUpdateSetUrl: self.link(sourceHostName, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`),

                                    targetHostName,
                                    remoteUpdateSetID: run.collision.remoteUpdateSetID,
                                    remoteUpdateSetUrl: run.collision.remoteUpdateSetUrl,
                                    previewProblems: (e.previewProblems.length) ? e.previewProblems.map((p) => { p.link += '&sysparm_view=cicd_preview'; return p }) : [],
                                    dataLossWarnings: (e.dataLossWarnings.length) ? e.dataLossWarnings.map((d) => { d.link += '&sysparm_view=cicd_preview'; return d }) : []
                                }
                            });
                        })

                    }
                    return slack.build.failed(`*${run.config.application.name} › ${run.config.updateSet.name} › #${run.sequence}*\nERROR!\n\n${e.name}!\n${e.message}. <${config.updateSet.name}>\n\n<${run.config.application.docUri}|details>`).then(() => {
                        const requestor = config.build.requestor;
                        return self.email.onPreviewFailure({
                            recipient: `"${requestor.fullName}" <${requestor.email}>`,
                            data: {
                                errorName: e.name,
                                errorMessage: e.message,
                                sequence: run.sequence,
                                sourceHostName,
                                sourceUpdateSetName: config.updateSet.name,
                                sourceUpdateSetID: config.updateSet.sys_id,
                                sourceUpdateSetUrl: self.link(sourceHostName, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`),
                                targetHostName
                            }
                        });
                    }).then(() => {
                        throw e;
                    });

                });
            });

        })

    }).then(() => {
        return run;
    });
};
