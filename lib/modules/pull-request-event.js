const Promise = require('bluebird');
const uui = require('uuid/v4');
const fs = require('fs-extra');
const path = require('path');
/**
 * Pull request resolve
 *
 * @param {*} body the pull request message
 * @returns {Promise<void>}
 */
module.exports = function ({ body }, logger = console, { host }) {
    const self = this;
    const slack = self.getSlack();
    let config = {};
    let run;

    if (!body.action || !body.target || !body.target.branch)
        return Promise.try(() => {
            return console.warn(`seems not to be a valid pull request inbound:`, body);
        });

    return Promise.try(() => {
        const regex = /^(\S+)-@([a-f0-9]{32})$/gi;
        let updateSetId;

        // target must be master
        if (body.target.branch != 'master')
            throw Error(`target must be 'master' ${body.target.branch}`);

        // search for update-set sys-id
        const checkMatch = regex.exec(body.source.branch);
        if (checkMatch && checkMatch.length) {
            updateSetId = checkMatch[2];
        } else {
            throw Error(`source branch is invalid: ${body.source.branch}`);
        }

        return { body: body, updateSetId: updateSetId };

    }).then(({ body, updateSetId }) => {

        // check if it needs any interaction with the update-set
        const action = (body.action || '').toLowerCase();
        const decline = action.includes('decline'),
            merge = action.includes('merge'),
            deleted = action.includes('delete');

        if (!decline && !merge && !deleted) {
            return; // only handle known actions
        }

        return Promise.try(() => {
            return self.db.us.findOne({ updateSetId });
        }).then((us) => {
            if (!us || !us.runId) {
                throw Error(`UpdateSet or Run not found with ID ${updateSetId}`);
            }

            // disable the pull request
            us.pullRequestRaised = false;
            return self.db.us.update(us).then(() => us);
        }).then((us) => {
            // lookup corresponding 'run'
            const runId = us.runId;
            return self.db.run.get({ _id: runId }).then((run) => {
                if (!run)
                    throw Error(`Run not found with ID ${runId}`);
                return run;
            });

        }).then((_run) => {
            run = _run;
            config = run.config;
            if (!config)
                throw Error("No configuration found for this run");

            const step = (message, error) => {
                return self.addStep(logger, config, `${path.basename(__filename).split('.')[0]}.merge_base : ${message}`, error);
            };
            return Promise.try(() => {
                if (merge && !body.mergeId) {
                    /*
                        get the merge ID from git clone

                        This is a fallback if the PR web hook does not contain the
                        mergeId.
                        Its actually not very save and needs re-work. (delay and assumes no commits in between)
                    */
                    const commitId = run.commitId;
                    const tmpDir = path.join(config.application.dir.tmp, uui());
                    const git = new self.Git({
                        dir: tmpDir,
                        remoteUrl: config.git.remoteUrl,
                        quiet: true,
                        user: {
                            name: process.env.CICD_GIT_USER_NAME || null,
                            email: process.env.CICD_GIT_USER_EMAIL || null
                        }
                    });

                    return fs.ensureDir(tmpDir).then(() => {
                        return step(`Checking out git repo ${config.git.remoteUrl} on commit ${commitId}`);
                    }).then(() => {
                        return git.exec({
                            quiet: true,
                            args: `clone ${config.git.remoteUrl} ${tmpDir}`
                        });
                    }).then(() => {
                        return git.exec({
                            quiet: true,
                            args: `rev-list --merges HEAD --not ${commitId} --reverse`
                        }).then((out) => {
                            return out.split(/[\r\n]+/).filter((row) => {
                                return (row && row.length);
                            })[0].trim();
                        });
                    }).then((base) => {
                        return step(`merge commit id is ${base}`).then(() => {
                            body.mergeId = base;
                        });
                    }).then(() => {
                        // remove the directory now to save space
                        return fs.remove(tmpDir);
                    });
                }
            }).then(() => {
                if (merge && body.mergeId && !run.branchCommitId) {
                    // branch was merged. replace the commit ID with the new one
                    run.branchCommitId = run.commitId;
                    run.commitId = body.mergeId;
                    run.merged = true;

                    run.config.build.branchCommitId = run.config.build.commitId
                    run.config.build.commitId = body.mergeId;

                    config = run.config;

                    return self.db.run.update(run)
                }
            }).then(() => {
                return config;
            });

        }).then((config) => {
            const step = (message, error) => {
                return self.addStep(logger, config, `${path.basename(__filename).split('.')[0]}.process : ${message}`, error);
            };

            if (!merge) { // TODO: in case of later delete (after approve), dont update the US
                return step(`pull request result for '${config.updateSet.name}' is '${action}' set update-set status to '${self.build.CODE_REVIEW_REJECTED}'`).then(() => {
                    return self.setProgress(config, self.build.CODE_REVIEW_REJECTED);
                }).then(() => {
                    return self.setRunState(run, self.run.PULL_REQUEST_REJECTED);
                }).then(() => {
                    // this is the last option to finalize a run
                    return self.finalizeRun(config);
                });
            }

            return Promise.try(() => {

                return self.setRunState(run, self.run.PULL_REQUEST_APPROVED);

            }).then(() => {
                //return self.deleteBranch(config, config.branchName);
            }).then(() => {
                if (config.deploy && !config.deploy.enabled)
                    return step(`Pull request merged, but not deployment target environment specified.`).then(() => {
                        return step(`complete update-set ${config.updateSet.name}`);
                    }).then(() => {
                        return self.setProgress(config, self.build.COMPLETE);
                    }).then(() => {
                        return self.setRunState(run, self.run.COMPLETED_NO_DEPLOY);
                    }).then(() => {
                        return slack.message(`*${run.config.application.name} › ${run.config.updateSet.name} › #${run.sequence}*\nPULL-REQUEST - Merged but no target.\n\nPull request merged, but not deployment target environment specified. Update-Set <${self.link(config.host.name, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`)}|${config.updateSet.name}> needs to be deployed manually!\n\n<${run.config.application.docUri}|details>`);
                    });

                if (!config.deploy || !(config.deploy && config.deploy.onPullRequestResolve))
                    return step(`Pull request merged, but deployment 'onPullRequestResolve' is disabled!`).then(() => {
                        return step(`complete update-set ${config.updateSet.name}`);
                    }).then(() => {
                        return self.setProgress(config, self.build.COMPLETE);
                    }).then(() => {
                        return self.setRunState(run, self.run.COMPLETED_NO_DEPLOY);
                    }).then(() => {
                        return slack.message(`*${run.config.application.name} › ${run.config.updateSet.name} › #${run.sequence}*\nPULL-REQUEST - Merged but deployment disabled.\n\nPull request merged, but deployment 'onPullRequestResolve' is disabled. Update-Set <${self.link(config.host.name, `/sys_update_set.do?sys_id=${config.updateSet.sys_id}`)}|${config.updateSet.name}> needs to be deployed manually!\n\n<${run.config.application.docUri}|details>`);
                    });

                return Promise.try(() => {
                    return step(`deploy update-set ${config.updateSet.name}`);
                }).then(() => {
                    // run deployment via wrapper
                    const deploymentWrapper = require('../deployment-wrapper');
                    return deploymentWrapper.run.call(self, { commitId: config.build.commitId, deploy: true });
                });
            });

        });
    });
};
