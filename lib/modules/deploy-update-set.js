const Promise = require('bluebird');
const assign = require('object-assign-deep');
const path = require("path");

/**
 * Deploy an update-set to a target ServiceNow environment
 *
 * @param {*} commitId the commit ID of the US to be deployed
 * @param {*} to alternative target environment [default from initial request 'config.deploy.host.name']
 * @returns {Promise<void>}
 */
module.exports = function ({ commitId, to }, logger = console, { host }) {
    const self = this;
    let config = {};
    let run;
    let targetHostName;
    let targetFQDN;
    const slack = self.getSlack();


    const step = (message, error) => {
        return self.addStep(logger, config, `${path.basename(__filename).split('.')[0]}.deployUpdateSet : ${message}`, error);
    };

    return self.db.run.findOne({
        commitId,
        buildPass: true
    }).then((_run) => {
        if (!_run)
            throw Error(`Run not found with commitId ${commitId}`);

        run = _run;
        if (run.buildPass !== true)
            throw Error(`Build did not pass. Cant deploy commit ${commitId}`);

        config = run.config;

        if (to) {
            targetHostName = to.toLowerCase();
            if (!targetHostName.startsWith('https://'))
                targetHostName = `https://${targetHostName}`;
        } else {
            targetHostName = (config.deploy && config.deploy.host && config.deploy.host.name) ? config.deploy.host.name : null;
        }

        if (!targetHostName)
            throw Error("Target Host Name not specified.");

        const m = targetHostName.match(/(?:http[s]?:\/\/)([^\.]*)([^:\/]*)/i);
        targetFQDN = (m) ? m[1] : targetHostName;

        run.deploy = assign({}, run.deploy);
        run.deployState = 'requested';
        run.deploy[targetFQDN] = {
            state: run.deployState,
            start: new Date().getTime()
        };

        return self.db.run.update(run);

    }).then(() => {
        return step(`complete update-set ${config.updateSet.name}`);

    }).then(() => {
        return self.setProgress(config, this.build.COMPLETE);

    }).then(() => {
        if (!(targetHostName)) {
            return step(`Deploy is disabled for this update-set`).then(() => {
                return slack.message(`Update-Set <${config.host.name}/sys_update_set.do?sys_id=${config.updateSet.sys_id}|${config.updateSet.name}> needs to be deployed manually!`);
            });
        }

        return step(`deploying updateSet '${config.updateSet.sys_id}'  to '${targetHostName}'`).then(() => {
            return slack.message(`Deploying Update-Set <${config.host.name}/sys_update_set.do?sys_id=${config.updateSet.sys_id}|${config.updateSet.name}> from ${config.host.name} to ${targetHostName}`);

        }).then(() => { // deploy the update set

            const varName = `${((targetFQDN) ? `_${targetFQDN.toUpperCase()}` : '')}_USER`;
            const username = process.env[`CICD_CD${varName}_NAME`] || process.env.CICD_CD_USER_NAME || process.env[`CICD_CI${varName}_NAME`] || process.env.CICD_CI_USER_NAME;
            const password = process.env[`CICD_CD${varName}_PASSWORD`] || process.env.CICD_CD_USER_PASSWORD || process.env[`CICD_CI${varName}_PASSWORD`] || process.env.CICD_CI_USER_PASSWORD;

            return self.getClient(config).deployUpdateSet(config.updateSet.sys_id, targetHostName, {
                username: username,
                password: password
            }).then(({ result, seconds }) => {
                
                return step(`UpdateSet successfully deployed in ${seconds} sec. Result: ${result}`).then(() => {
                    return slack.build.complete(`Update-Set <${config.host.name}/sys_update_set.do?sys_id=${config.updateSet.sys_id}|${config.updateSet.name}> committed on <${targetHostName}/sys_update_set.do?sys_id=${result.targetUpdateSetSysId}|${targetHostName}> within ${seconds} sec`);
                }).then(() => {
                    const info = run.deploy[targetFQDN];
                    run.deployState = info.state = 'completed';
                    info.end = new Date().getTime();
                    delete info.error;
                    return self.db.run.update(run);
                });

            }).catch((e) => {
                if (!e.updateSet) {
                    const info = run.deploy[targetFQDN];
                    run.deployState = info.state = 'failed';
                    info.end = new Date().getTime();
                    info.error = e.message;
                    return self.db.run.update(run).then(() => {
                        throw e;
                    }).then(() => {
                        const message = `${e.name}!\n${e.message}. <${config.updateSet.name}>`;
                        return slack.build.failed(message);
                    });
                }

                return Promise.try(() => {
                    return step(`Commit needs manual interaction!`, e);
                }).then(() => {
                    const info = run.deploy[targetFQDN];
                    run.deployState = info.state = 'manual_interaction';
                    info.end = new Date().getTime();
                    delete info.error;
                    return self.db.run.update(run);
                }).then(() => {
                    const message = `${e.name}!\n${e.message}. <${e.updateSet}>`;
                    return slack.build.failed(message);
                });
            });
        });
    });
};