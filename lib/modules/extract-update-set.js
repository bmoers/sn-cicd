const path = require('path');
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
module.exports = async function ({ deploymentId, count, xmlSysIds }, logger = console, { host }, resp) {
    const self = this;

    const getUpdateSetFiles = async ({ config, tmpDir, scopeDir, mergedDeployment, baselineCommitId, commitId, artifact }) =>  {

        const git = new self.Git({
            dir: tmpDir,
            remoteUrl: config.git.remoteUrl,
            quiet: true,
            user: self.getGitCredentials(config),
        });

        const exists = await fs.pathExists(scopeDir);

        if (!exists) {
            let start = Date.now();
            await fs.emptyDir(tmpDir);

            await step(`Cloning git repo ${config.git.remoteUrl} to ${tmpDir}`);

            await git.exec({
                quiet: true,
                args: `clone -n ${config.git.remoteUrl} ${tmpDir}`
            });
            await step(`clone completed in ${(Date.now() - start) / 1000}sec`);

            await step(`Checking out git repository ${config.git.remoteUrl} on commit ${commitId}`);
            start = Date.now();
            await git.exec({
                quiet: true,
                args: `checkout ${commitId}`
            });
            await step(`checkout completed in ${(Date.now() - start) / 1000}sec`);

            // the scope dir must exist at this point
            const scopeDirExists = await fs.pathExists(scopeDir);
            if (!scopeDirExists)
                throw Error(`File ${scopeDir} not found in commit ${commitId}`);
        }

        let updateSetFiles;

        if (mergedDeployment) {
            const range = (baselineCommitId) ? `${baselineCommitId}...${commitId}` : commitId;
            if (baselineCommitId) {
                logger.info(`searching all update set created between commits ${baselineCommitId}...${commitId}`);
            } else {
                logger.info(`searching all update set created up to commit ${commitId}`);
            }

            updateSetFiles = await git.listFiles(`${scopeDir}/*.xml`, range).then((list) => {
                if (list.length)
                    return list;
                return [artifact];
            });

            logger.log('updateSetFiles to be merged:', updateSetFiles);

        } else {
            updateSetFiles = [artifact];
        }

        // make unique in case of multiple runs with the same update set
        return [...new Set(updateSetFiles)];
    };

    const getFileChangeArray = async  ({ config, tmpDir, scopeDir, mergedDeployment, baselineCommitId, commitId, artifact }) => {

        const cache = path.join(scopeDir, 'cache.json');
        const cacheExists = await fs.pathExists(cache);

        if (cacheExists) {
            logger.log(`cache file exists, get fileChangeArray from '${cache}'`);
            return fs.readJson(cache, {
                encoding: 'utf8'
            });
        }

        logger.log(`generating cache file '${cache}'`);

        const parseConfig = {
            'sys_update_xml': {
                fields: ['sys_id', 'sys_updated_on', 'sys_recorded_at', 'name', 'action', 'payload']
            }
        };
        const filterStrings = ['<is_private>true</is_private>', '&lt;is_private&gt;true&lt;/is_private&gt;'];
        const regex = new RegExp(filterStrings.join('|'), 'i');

        const updateSetFiles = await getUpdateSetFiles({ config, tmpDir, scopeDir, mergedDeployment, baselineCommitId, commitId, artifact });

        const mergedPromises = updateSetFiles.map((file, fileIndex) => { // extract all file, name, etc information from all files
            const filePath = path.join(tmpDir, file);
            logger.log(`Parsing update set '${filePath}' for content`);

            return streamer.parse({
                file: filePath,
                parseConfig
            }).then((out) => {
                return out.map((element, index) => {
                    let deploy = true;
                    if ((/sys_properties_[a-fA-F0-9]{32}/).test(element.name)) {
                        deploy = !regex.test(element.payload);
                    }
                    return {
                        filePath,
                        name: element.name,
                        sysId: element.sys_id,
                        recordedAt: parseInt(element.sys_recorded_at, 16),
                        updatedOn: new Date(element.sys_updated_on).getTime(),
                        fileIndex,
                        index,
                        action: element.action,
                        deploy: deploy
                    };
                });
            });
        });

        const mergedResults = await Promise.all(mergedPromises); // wait for all files to be parsed
        /* unique check must be done after all merged results are here due to parallel processing of .all() */

        //logger.info("mergedResults");
        //logger.info(mergedResults)

        const results = [].concat.apply([], mergedResults); // flatten array

        console.log(`total number of changes in all update set files ${results.length}`);

        /* { name : { filePath, sysId, recordedAt, updatedOn } } */
        const fileChangeStructure = {};

        results.sort((a, b) => { // make sure its in the right order 
            return a.fileIndex - b.fileIndex || a.index - b.index;
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
                logger.error(`ERROR: the element '${element.name}' is from an older update set but has a newer timestamp:`, element, existingElement);
            } 

        });

        const array = Object.keys(fileChangeStructure).map((key) => { // convert to an array
            return fileChangeStructure[key];
        }).sort((a, b) => { // and order ASC, oldest first
            if (isNaN(a.recordedAt)) {
                return a.updatedOn - b.updatedOn;
            } else {
                return a.recordedAt - b.recordedAt;
            }
        }).filter((r) => r.deploy); // remove records which are set private

        await fs.writeJson(cache, array, { encoding: 'utf8' });

        logger.log(`cache file created with total '${array.length}' changes from '${updateSetFiles.length}' update set files`);
    
        return array;

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
    };
    
    let config = {};
    const step = (message, error) => {
        return self.addStep(logger, config, `${path.basename(__filename).split('.')[0]}.extractUpdateSet : ${message}`, error);
    };

    let updateSetSysId;
    let mergedDeployment;
    let forcedDeployment;
    let tmpDir;
    let scopeDir;

    const deployment = await self.db.deployment.findOne({
        _id: deploymentId
    });

    if (!deployment)
        throw Error(`Deployment not found with id ${deploymentId}`);

    deployment.host = host;
    await self.db.deployment.update(deployment);

    const run = await self.db.run.findOne({
        _id: deployment.runId
    });
    if (!run)
        throw Error(`UpdateSet not found with id ${deployment.runId}`);

    config = run.config;
    const { baselineCommitId, commitId, scopeName } = deployment;

    updateSetSysId = config.updateSet.sys_id;
    
    // always merge all update sets 
    mergedDeployment = config.mergedDeployment;

    // ensure the new records are deployed - even if there is a newer on the target environment
    forcedDeployment = config.forcedDeployment;

    tmpDir = path.resolve(config.application.dir.tmp, deploymentId);

    // the scopeName of the deployment (record) is relevant, not the original scopeName of the update set 'config.updateSet.scopeName'
    scopeDir = path.join(tmpDir, 'us', scopeName);
    
    // this is the artifact of the current change. in increment mode only this one will be deployed
    const artifact = config.build.artifact ? config.build.artifact : `sys_update_set_${updateSetSysId}.xml`;
    if (mergedDeployment) {
        logger.info(`[Merged Deployment] Extracting all UpdateSet in '${scopeDir}' from ${config.git.remoteUrl}`);
    } else {
        logger.info(`[Individual Deployment] Extracting UpdateSet '${artifact}' from ${config.git.remoteUrl}`);
    }

    const fileChangeArray = await getFileChangeArray({ config, tmpDir, scopeDir, mergedDeployment, baselineCommitId, commitId, artifact });
    //logger.log(fileChangeArray)

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
            out[element.filePath] = [element.sysId];
        }
        return out;
    }, {});

    const batchPromises = Object.keys(batchObj).map((filePath) => { // parse the related sys_ids from each file
        //logger.log("parse file", filePath, 'for sysids', batchObj[filePath]);
        return streamer.parse({
            file: filePath,
            parseConfig,
            filterSysIds: batchObj[filePath]
        });
    });

    const batchResults = await Promise.all(batchPromises);  // wait for all parser to end

    //logger.dir(batchResults, { depth: null, colors: true });
    const date = new Date();

    // flatten results array and ensure everything is in the right order
    const result = [].concat.apply([], batchResults)
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
                element.payload._cdata = updatePayloadTimestamp(element.payload._cdata, date);
            } else {
                element.payload = updatePayloadTimestamp(element.payload, date);
            }
            //logger.log(element.payload);
            return element;
        });

    if (result.length != 250) {
        
        deployment.host = undefined;
        await self.db.deployment.update(deployment);

        // remove the directory now to save space
        await fs.remove(tmpDir).catch((e) => {
            logger.warn(`Issues with deleting temp dir ${tmpDir}`, e);
        });
        logger.info('directory cleaned', tmpDir);
        
    }

    //logger.dir(result, { depth: null, colors: true });
    
    return streamer.toXml({
        'count': result.length,
        'getRecordsResult': result.map((res) => {
            res.update_set = updateSetSysId;
            delete res.remote_update_set;
            return res;
        })
    });

    /*
    in case the extraction does not perform (even tough a 'page' is limited to 250 rows) we can stream the xml directly to the response object
    if (resp) {
        const Readable = require('stream').Readable;
        const s = new Readable();
        s._read = () => { }; // redundant? see update below
        s.push(`<count>${batchArray.length}</count>`);

        s.pipe(resp);

        return Promise.each(Object.keys(batchObj), (filePath) => { // parse the sys_ids from each file
            logger.log("parse file", filePath, 'for sysids', batchObj[filePath])
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

};
