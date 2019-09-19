const path = require("path");
const fs = require('fs-extra');
const streamer = require('../ext/us-streamer');
const Promise = require('bluebird');

/**
 * Extract Update-Set information from local XML file.
 *
 *   TODO: get XML from fresh cloned git repo
 * 
 * @param {*} deploymentId the deployment ID of the US to extracted.
 * @param {*} to alternative target environment [default from initial request 'config.deploy.host.name']
 * @returns {Promise<void>}
 */
module.exports = function ({ deploymentId, count, xmlSysIds }, logger = console, { host }, resp) {
    const self = this;
    let config = {};
    let updateSetSysId;
    let mergedDeployment;
    let forcedDeployment;
    let scopeDir;
    let tmpDir;

    const step = (message, error) => {
        return self.addStep(logger, config, `${path.basename(__filename).split('.')[0]}.extractUpdateSet : ${message}`, error);
    };

    const updatePayloadTimestamp = (payload, date) => {

        const regex = /((?:<|&lt;)sys_updated_on(?:>|&gt;))([\d$]{4}-[\d$]{2}-[\d$]{2}\s[\d$]{2}:[\d$]{2}:[\d$]{2})((?:<|&lt;)\/sys_updated_on(?:>|&gt;))/gmi;

        const nowUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds());
        const dateString = new Date(nowUtc).toISOString().replace('T', ' ').substr(0, 19);

        let current, max, maxIndex, maxLastIndex, open, close;
        let m;
        // find the max(sys_updated_on) position
        while ((m = regex.exec(payload)) !== null) {
            // This is necessary to avoid infinite loops with zero-width matches
            if (m.index === regex.lastIndex) { regex.lastIndex++; }

            current = m[2];

            if (current > max || max == undefined) {
                max = current;
                maxIndex = m.index;
                maxLastIndex = regex.lastIndex;
                open = m[1].replace('sys_updated_on', `sys_updated_on cicd_prev="${current}"`);
                close = m[3];
            }
        }
        // replace with current timestamp in UTC
        if (max)
            payload = `${payload.substring(0, maxIndex)}${open}${dateString}${close}${payload.substring(maxLastIndex)}`;

        return payload;
    }

    return self.db.deployment.findOne({
        _id: deploymentId
    }).then((deployment) => {
        if (!deployment)
            throw Error(`Deployment not found with id ${deploymentId}`);

        return self.db.run.findOne({
            _id: deployment.runId
        }).then((run) => {
            if (!run)
                throw Error(`UpdateSet not found with id ${deployment.runId}`);

            config = run.config;
            return deployment;
        });

    }).then(({ baselineCommitId, commitId }) => {


        updateSetSysId = config.updateSet.sys_id;
        // always merge all update sets 
        mergedDeployment = config.application.mergedDeployment;
        // ensure the new records are deployed - even if there is a newer on the target environment
        forcedDeployment = config.application.forcedDeployment;

        tmpDir = path.resolve(config.application.dir.tmp, commitId);
        scopeDir = path.join(tmpDir, 'us', config.updateSet.scopeName);

        // this is the artifact of the current change. in increment mode only this one will be deployed
        const artifact = config.build.artifact ? config.build.artifact : `sys_update_set_${updateSetSysId}.xml`;
        if (mergedDeployment) {
            logger.info(`[Merged Deployment] Extracting all UpdateSet in '${scopeDir}' from ${config.git.remoteUrl}`);
        } else {
            logger.info(`[Increment Deployment] Extracting UpdateSet '${artifact}' from ${config.git.remoteUrl}`);
        }

        const git = new self.Git({
            dir: tmpDir,
            remoteUrl: config.git.remoteUrl,
            quiet: true,
            user: {
                name: process.env.CICD_GIT_USER_NAME || null,
                email: process.env.CICD_GIT_USER_EMAIL || null
            }
        });



        return fs.pathExists(scopeDir).then((exists) => { // clone repository if not exists
            if (exists)
                return step(`File is already checked out`); // was checked out to run "count"

            let start = Date.now();

            return fs.emptyDir(tmpDir).then(() => {
                return step(`Cloning git repo ${config.git.remoteUrl} to ${tmpDir}`);
            }).then(() => {
                return git.exec({
                    quiet: true,
                    args: `clone -n ${config.git.remoteUrl} ${tmpDir}`
                });
            }).then(() => {
                return step(`clone completed in ${(Date.now() - start) / 1000}sec`);
            }).then(() => { // check out commit
                start = Date.now();

                return git.exec({
                    quiet: true,
                    args: `checkout ${commitId}`
                }).then(() => {
                    return step(`checkout completed in ${(Date.now() - start) / 1000}sec`);
                });
            });
        }).then(() => {
            return step(`Checking out git repository ${config.git.remoteUrl} on commit ${commitId}`);
        }).then(() => { // check if project contains update set for this scope
            return fs.pathExists(scopeDir).then((exists) => {
                if (!exists)
                    throw Error(`File ${scopeDir} not found in commit ${commitId}`);
            });
        }).then(() => { // get list of all update sets in the /us directory, files are in reverse chronological order

            if (mergedDeployment && baselineCommitId) {

                logger.info(`searching all update sets created between commits ${baselineCommitId}...${commitId}`);

                return git.listFiles(`${scopeDir}/*.xml`, `${baselineCommitId}...${commitId}`).then((list) => {
                    if (list.length)
                        return list;
                    return [artifact]
                });
            } else {
                return [artifact];
            }
        }).then((updateSetFiles) => {
            // make unique in case of multiple runs with the same update set
            return [...new Set(updateSetFiles)];
        });



    }).then((updateSetFiles) => {

        if (mergedDeployment)
            logger.log('updateSetFiles to be merged:', updateSetFiles);

        const cache = path.join(scopeDir, 'cache.json');

        return fs.pathExists(cache).then((exists) => {
            if (exists)
                return fs.readJson(cache, {
                    encoding: 'utf8'
                });

            const parseConfig = {
                'sys_update_xml': {
                    fields: ['sys_id', 'sys_updated_on', 'sys_recorded_at', 'name', 'action']
                }
            };

            const mergedPromises = updateSetFiles.map((file, fileIndex) => { // extract all file, name, etc information from all files
                const filePath = path.join(tmpDir, file);
                logger.log(`Parsing update set '${filePath}' for content`);

                return streamer.parse({
                    file: filePath,
                    parseConfig
                }).then((out) => {
                    return out.map((element, index) => {
                        return {
                            filePath,
                            name: element.name,
                            sysId: element.sys_id,
                            recordedAt: parseInt(element.sys_recorded_at, 16),
                            updatedOn: new Date(element.sys_updated_on).getTime(),
                            fileIndex,
                            index,
                            action: element.action
                        };
                    });
                });
            });

            return Promise.all(mergedPromises).then((mergedResults) => { // wait for all files to be parsed
                /* unique check must be done after all merged results are here due to parallel processing of .all() */

                //console.log(mergedResults)

                const results = [].concat.apply([], mergedResults) // flatten array

                /* { name : { filePath, sysId, recordedAt, updatedOn } } */
                const fileChangeStructure = {};


                results.sort((a, b) => { // make sure its in the right order 
                    return a.fileIndex - b.fileIndex || a.index - b.index
                }).forEach((element) => { // find latest change in files (newest update set file wins)

                    const existingElement = fileChangeStructure[element.name];

                    if (!existingElement || (element.fileIndex == existingElement.fileIndex && (element.recordedAt > existingElement.recordedAt || element.updatedOn > existingElement.updatedOn))) {
                        // files from the same file are allowed to override other elements (e.g. deletes)
                        if (existingElement)
                            logger.warn(`Replacing element '${element.name}'. Action '${existingElement.action}' replaced with '${element.action}' `);

                        fileChangeStructure[element.name] = element;

                    } else if (element.fileIndex != existingElement.fileIndex && (element.recordedAt > existingElement.recordedAt || element.updatedOn > existingElement.updatedOn)) {
                        /* TODO:
                            throw exception; if there is an record in an older update set but has newer timestamp something is wrong!
                        */
                        logger.error(`ERROR: the element '${element.name}' is from an older update set but has a newer timestamp:`, element, existingElement)
                    }

                });

                return Object.keys(fileChangeStructure).map((key) => { // convert to an array
                    return fileChangeStructure[key];
                }).sort((a, b) => { // and order ASC, oldest first
                    if (isNaN(a.recordedAt)) {
                        return a.updatedOn - b.updatedOn;
                    } else {
                        return a.recordedAt - b.recordedAt;
                    }
                });
            }).then((fileChangeArray) => {
                return fs.writeJson(cache, fileChangeArray, { encoding: 'utf8' }).then(() => fileChangeArray);
            });
        });

    }).then((fileChangeArray) => {

        //console.log(fileChangeArray)

        if (count) { // only return the count of sys_ids 

            const sysIds = fileChangeArray.map((xml) => xml.sysId);
            const out = {
                sys_id: sysIds.join(','),
                count: fileChangeArray.length
            };
            /*
            // for debugging

            ((myArray, chunkSize) => {
                var index = 0, arrayLength = myArray.length, tempArray = [];
                for (index = 0; index < arrayLength; index += chunkSize) {
                    tempArray.push(myArray.slice(index, index + chunkSize));
                }
                return tempArray;
            })(sysIds, 250).forEach((arr, index) => {
                out[`page_${index}`] = arr.join(',');
            })
            */
            return out;
        }


        // extract the payload from the files
        const parseConfig = {
            'sys_update_xml': {
                fields: '*'
            }
        };
        // filter on the sys_ids requested in this batch export (generated in SNOW by the count response above)
        const filterSysIds = (xmlSysIds || '').split(',');
        const batchArray = fileChangeArray.filter((xml) => filterSysIds.includes(xml.sysId));

        const batchObj = batchArray.reduce((out, element) => {
            const ex = out[element.filePath];
            if (ex) {
                ex.push(element.sysId);
            } else {
                out[element.filePath] = [element.sysId]
            }
            return out;
        }, {});


        /*
        in case the extraction does not perform (even tough a 'page' is limited to 250 rows) we can stream the xml directly to the response object
        if (resp) {
            const Readable = require('stream').Readable;
            const s = new Readable();
            s._read = () => { }; // redundant? see update below
            s.push(`<count>${batchArray.length}</count>`);

            s.pipe(resp);

            return Promise.each(Object.keys(batchObj), (filePath) => { // parse the sys_ids from each file
                console.log("parse file", filePath, 'for sysids', batchObj[filePath])
                return streamer.parse({
                    file: filePath,
                    parseConfig,
                    filterSysIds: batchObj[filePath]
                }, (element) => {
                    // every single element from the list
                    s.push(`<getRecordsResult>${streamer.toXml(element)}</getRecordsResult>`);
                });
            }).then(() => {
                s.push(null);
            });
        }
        */


        const batchPromises = Object.keys(batchObj).map((filePath) => { // parse the related sys_ids from each file
            //console.log("parse file", filePath, 'for sysids', batchObj[filePath]);
            return streamer.parse({
                file: filePath,
                parseConfig,
                filterSysIds: batchObj[filePath]
            });
        });

        return Promise.all(batchPromises).then((batchResults) => { // wait for all parser to end

            //console.dir(batchResults, { depth: null, colors: true });
            const date = new Date();

            // flatten results array and ensure everything is in the right order
            return [].concat.apply([], batchResults)
                .sort((a, b) => (parseInt(a.sys_recorded_at, 16) - parseInt(b.sys_recorded_at, 16)))
                .map((element) => {
                    if (!forcedDeployment)
                        return element;

                    /*
                        to ensure the target record gets overwritten with the new one:
                            - clear the value in the fields: update_guid, update_guid_history
                            - search for the sys_update_on field in the payload and set it to current timestamp (UTC).
                        the preview function parses the payload for timestamp if the guid_history information is not in place
                    */

                    element.update_guid = '';
                    element.update_guid_history = '';
                    if (element.payload._cdata) {
                        element.payload._cdata = updatePayloadTimestamp(element.payload._cdata, date)
                    } else {
                        element.payload = updatePayloadTimestamp(element.payload, date)
                    }
                    //console.log(element.payload);
                    return element;
                });

        }).then((result) => {

            // remove the directory now to save space
            return fs.remove(tmpDir).catch((e) => {
                logger.warn(`Issues with deleting temp dir ${tmpDir}`, e);
            }).then(() => {
                logger.info("directory cleaned", tmpDir);
                //console.dir(result, { depth: null, colors: true });

                return streamer.toXml({
                    'count': result.length,
                    'getRecordsResult': result.map((res) => {
                        res.update_set = updateSetSysId;
                        delete res.remote_update_set;
                        return res;
                    })
                });
            });
        });
    });
};
