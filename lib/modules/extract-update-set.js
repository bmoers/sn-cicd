const path = require("path");
const fs = require('fs-extra');
/**
 * Extract Update-Set information from local XML file.
 *
 *   TODO: get XML from fresh cloned git repo
 * 
 * @param {*} commitId the commit ID of the US to extracted.
 * @param {*} to alternative target environment [default from initial request 'config.deploy.host.name']
 * @returns {Promise<void>}
 */
module.exports = function ({ commitId, count, xmlSysIds }, logger = console, { host }) {
    const self = this;
    let config = {};
    let updateSetSysId;

    const step = (message, error) => {
        return self.addStep(logger, config, `${path.basename(__filename).split('.')[0]}.extractUpdateSet : ${message}`, error);
    };

    return self.db.run.findOne({
        commitId: commitId
    }).then((run) => {
        if (!run)
            throw Error(`UpdateSet not found with commitId ${commitId}`);

        config = run.config;
        updateSetSysId = config.updateSet.sys_id;

        const tmpDir = path.resolve(config.application.dir.tmp, commitId);
        const dir = path.join(tmpDir, 'us', config.updateSet.scopeName);
        const file = path.join(dir, `sys_update_set_${updateSetSysId}.xml`);

        return fs.pathExists(file).then((exists) => {
            if (exists)
                return step(`File is already checked out`); // was checked out to run "count"

            const git = new self.Git({
                dir: tmpDir,
                remoteUrl: config.git.remoteUrl,
                quiet: true,
                user: {
                    name: process.env.CICD_GIT_USER_NAME || null,
                    email: process.env.CICD_GIT_USER_EMAIL || null
                }
            });
            const start = Date.now();
            return fs.ensureDir(tmpDir).then(() => {
                return step(`Checking out git repo ${config.git.remoteUrl} on commit ${commitId}`);
            }).then(() => {
                return git.exec({
                    quiet: true,
                    args: `clone -n ${config.git.remoteUrl} ${tmpDir}`
                });
            }).then(() => {
                return git.exec({
                    quiet: true,
                    args: `checkout ${commitId}`
                });
            }).then(() => {
                return step(`checkout completed in ${(Date.now() - start) / 1000}sec`);
            }).then(() => {
                return fs.pathExists(file);
            }).then((exists) => {
                if (!exists)
                    throw Error(`File ${path.join('us', config.updateSet.scopeName, `sys_update_set_${updateSetSysId}.xml`)} not found in commit ${commitId}`);
            });

        }).then(() => {
            return step(`Extract XLM from ${file}`);
        }).then(() => {
            const streamer = require('../us-streamer');
            if (count) {
                const parseConfig = {
                    'sys_update_xml': {
                        fields: ['sys_id', 'sys_updated_on', 'sys_recorded_at']
                    }
                };
                const filterSysIds = [];
                return streamer.parse({ file, parseConfig, filterSysIds }).then((result) => {

                    // ensure everything is in the right order
                    result = result.sort((a, b) => (parseInt(a.sys_recorded_at, 16) - parseInt(b.sys_recorded_at, 16)));

                    return {
                        sys_id: result.map((xml) => xml.sys_id).join(','),
                        count: result.length
                    };
                })
            } else {
                const parseConfig = {
                    'sys_update_xml': {
                        fields: '*'
                    }
                };
                const filterSysIds = (xmlSysIds || '').split(',');
                return streamer.parse({ file, parseConfig, filterSysIds }).then((result) => {

                    // ensure everything is in the right order
                    result = result.sort((a, b) => (parseInt(a.sys_recorded_at, 16) - parseInt(b.sys_recorded_at, 16)));

                    return streamer.toXml({
                        'count': result.length,
                        'getRecordsResult': result.map((res) => {
                            res.update_set = updateSetSysId;
                            delete res.remote_update_set;
                            return res;
                        })
                    });
                }).then(() => {
                    // remove the directory now to save space
                    return fs.remove(dir);
                });
            }

        });

    });
};
