const Promise = require('bluebird');
const fs = require('fs-extra')
const path = require("path");
const assign = require('object-assign-deep');
const etparse = require('elementtree').parse;

/**
 * Export all files of an application from 'source'. 
 * This is to mimic the developer work on a local branch.
 *
 * @param {*} runId id of the current run
 * @param {Console} logger a logger to be used
 * @param {Object} job job object 
 * @returns {Promise}
 */
module.exports = function (runId, logger = console, { host }) {
    const self = this;
    let config = {};
    let gulp = {};

    let project, client, git, run;

    const step = (message, error) => {
        return self.addStep(logger, config, `${path.basename(__filename).split('.')[0]} : ${message}`, error);
    };

    return Promise.try(() => {
        return self.db.run.get(runId).then((_run) => {
            if (!_run)
                throw Error(`Run not found with id ${runId}`);
            config = _run.config;
            run = _run;
        });
    }).then(() => {
        return self.setRunState(run, self.run.EXPORT_UPDATE_SET);

    }).then(() => {
        return self.getProject(config, config.branchName).then((_project) => {
            project = _project;
        });
    }).then(() => {
        gulp = assign({}, self.settings.buildConfig.gulp, { artifact: config.build.artifact });
        run.build = gulp;

        client = self.getClient(config);
        git = self.getGit(config);

        return self.setProgress(config, this.build.IN_PROGRESS);

    }).then(() => {
        if (config.git.enabled === true) {
            return Promise.try(() => {
                return git.fetch();
            }).then(() => {
                return step(`GIT switch to branch ${config.branchName}`);
            }).then(() => {
                return git.switchToBranch(config.branchName);
            }).then(() => {
                return step(`GIT pull from remote`);
            }).then(() => {
                return git.pull(config.branchName);
            }).then(() => {
                return step(`GIT merge branch '${config.branchName}' with '${config.master.name}'`);
            }).then(() => { // merge with master
                /*


                If the same line in the same file in master (prod) was changed as in the update set, this will
                cause a conflict.

                Normally the developer would manually resolve the issues, but as we cant do this manuals step here 
                the update set branch is set back to master.

                This is breaking the history line of the code within the update set. And e.g. fixes made after a pull
                request was rejected are not show up in comparison to the last state.

                To prevent merge collision against master later in the process, its required to align the
                update set branch with master at this point.
                    

                  no changes in master scenario
                   master     A                D
                               \              /
                   update set   B  -> C1 -> C2

                  changes in master scenario
                   master     A        ->       C     E 
                               \                 \   /
                   update set   B  -> D1 -> D2 ->  D   <- collision if C has overlapping changes with D

                  resetting update set branch
                   master     A    ->    C          E
                               \          \        /
                   update set   B  -> D -> C  -> D2
                   run                1st        2nd


                Not refreshing master branch would be an option but in that case the DIFF not be 100% accurate.
                

                TODO: 
                    - alert user as this means a file in service-now was changed after the record
                        was captured in the update-set -> AND it has unresolvable collisions (same line)!
                    - get the file name from the 'git status' command
                    - add a feature switch to control this behavior better
                */
                return git.merge(config.master.name).then(() => {
                    // clone master into update-set branch on DB level
                    //return project.cloneBranch();
                }).catch((e) => { // try to merge with master
                    //console.log(e);
                    return Promise.try(() => {
                        return step(`GIT merge failed. Abort now.`);
                    }).then(() => {
                        return git.mergeAbort();
                    }).then(() => {
                        return step(`Reset HARD from ${config.master.name}`);
                    }).then(() => {
                        return git.reset(config.master.name, true);
                    }).then(() => {
                        return step(`Push reset of ${config.master.name} to origin`);
                    }).then(() => {
                        // avoid triggering a CICD run
                        return git.commit({
                            messages: [`Merge with master failed. Reset hard to origin`, `no-cicd`],
                            empty: true
                        });
                    }).then(() => {
                        return git.push(config.branchName, true);
                    }).then(() => {
                        // delete the branch. remove all files based on information in DB
                        return project.deleteBranch();
                    });
                });
            });
        }
    }).then(() => { // export update-set as file
        return Promise.try(() => {
            return step(`Export update-set as XML file '${config.updateSet.sys_id}'`);
        }).then(() => {
            return client.exportUpdateSet(config.updateSet.sys_id);
        }).then((updateSet) => {
            return project.writeFile(config.build.artifact, updateSet.content);
        }).then((fileName) => {

            if (!run.collision.hasCollisions)
                return fileName;

            /*
                conflict resolution information is aded to the update set

                 -> the code in GIT always contains the preview conflict resolution information
            */
            const streamer = require('../ext/us-streamer');
            const fs = require('fs-extra');
            const modifiedUpdateSet = fileName;
            const originalUpdateSet = `${fileName}.backup`;
            return fs.move(modifiedUpdateSet, originalUpdateSet, { overwrite: true }).then(() => {
                return new Promise((resolve, reject) => {

                    const parseConfig = {
                        'sys_remote_update_set': {
                            fields: '*'
                        },
                        'sys_update_xml': {
                            fields: '*'
                        }
                    };

                    const stream = fs.createWriteStream(modifiedUpdateSet);
                    stream.on('finish', () => {
                        return resolve(modifiedUpdateSet);
                    });
                    stream.on('error', (e) => {
                        return reject(e);
                    });

                    stream.write(`<?xml version="1.0" encoding="UTF-8"?><unload unload_date="${new Date().toISOString().replace('T', ' ').substr(0, 19)}">\n`);

                    // stream the backup file
                    return streamer.parse({
                        file: originalUpdateSet,
                        parseConfig
                    }, (element) => {
                        const resolution = run.collision.solution.resolutions[element.name];
                        if (resolution) {
                            element._attributes.conflicted_on_host = resolution.host;
                            element._attributes.on_conflict = resolution.status;
                            element._attributes.if_target_older = resolution.updatedOn;
                        }
                        // the xml converter by default puts all on one line, the only way to get newlines between the elements is having indention an then remove the indention again.
                        stream.write(streamer.toXmlSync({ [element.___name]: element }, 1).replace(/^\s(<[^>]+>)/gm, '$1').concat('\n'));

                    }).then(() => {
                        stream.write('</unload>\n');
                        stream.end();
                    });

                });
            }).then(() => {
                return fs.remove(originalUpdateSet);
            }).then(() => {
                //console.log("modified file,", fileName);
                return fileName;
            });
        }).then((fileName) => {
            if (!config.git.enabled)
                return;
            return Promise.try(() => {
                return step(`Commit update-set XML '${fileName}'`);
            }).then(() => {
                return git.add(fileName).then(() => {
                    return git.commit({
                        author: {
                            email: config.build.requestor.email,
                            name: config.build.requestor.fullName
                        },
                        messages: [`Update Set XML file of '${config.updateSet.name}' -- Build #${config.build.sequence}`]
                    });
                });
            });
        });
    }).then(() => { // export update-set-xml 
        var updatedFiles = [];
        var deletedFiles = [];

        const scopeCache = new Map([
            ['global', { appName: 'Global', scopeName: 'global' }]
        ]);

        const getScopeDetails = (sysId) => {
            return Promise.try(() => {
                if (!sysId)
                    return {
                        appName: config.updateSet.appName,
                        scopeName: config.updateSet.scopeName,
                    };

                if (scopeCache.has(sysId))
                    return scopeCache.get(sysId);

                return client.getScopeDetails(sysId).then((results) => {
                    if (!results.length) {
                        scopeCache.set(sysId, null);
                        return null;
                    }
                    const scope = results[0];
                    const details = {
                        appName: scope.name,
                        scopeName: scope.scope
                    }
                    scopeCache.set(sysId, details);
                    return details;
                });
            });
        };

        return Promise.try(() => {
            return step(`Export XML '${config.updateSet.sys_id}'`);

        }).then(() => {
            return client.getUpdateSetFiles(config.updateSet.sys_id, (results) => {
                // process page-by-page
                return Promise.each(results, (result) => {

                    var resultUpdateFiles = [];
                    var resultDeleteFiles = [];
                    const nullForEmpty = config.application.nullForEmpty;
                    return Promise.try(() => { // parse the XML payload
                        /*
                        if (nullForEmpty) // add nill attribute to empty tags
                            result.payload = result.payload.replace(/<([^\/>]*)\/>/g, `<$1 xsi:nil="true"/>`).replace(/<([^\s\/>]*)[^>]*><\/(\1)>/g, `<$1 xsi:nil="true"/>`);
                        */
                        return etparse(result.payload);
                    }).then((xmlTree) => { // find all tables, action and sysId in the payload

                        // find one sys_scope in the payload
                        const defaultScope = xmlTree.findtext('.//sys_scope');

                        return Promise.each(xmlTree.findall('.//*[@action]'), (element) => {

                            var className = element.tag,
                                sysId = element.findtext('sys_id'),
                                action = element.attrib.action;

                            /*
                              only process payload if the entity is of interest
                            */
                            if (!(sysId && className && project.loadEntity(className)))
                                return;

                            // always take the scope from the XML
                            /*
                            console.log(['sys_scope', 'sys_app', 'sys_store_app'].includes(className) ? sysId : null);
                            console.log("element.findtext('sys_scope')", element.findtext('sys_scope'));
                            console.log('defaultScope', defaultScope)
                            console.log('config.updateSet.scopeId', config.updateSet.scopeId)
                            */
                            return Promise.try(() => {
                                return getScopeDetails(['sys_scope', 'sys_app', 'sys_store_app'].includes(className) ? sysId : element.findtext('sys_scope') || defaultScope || config.updateSet.scopeId);
                            }).then((scope) => {
                                if (!scope) {
                                    console.error('Scope not found!');
                                    console.log(result.payload)
                                }
                                if ('INSERT_OR_UPDATE' == action) {
                                    // get a list of params used with this entity type
                                    var file = {},
                                        requestArguments = project.getEntityRequestParam(className),
                                        fieldNames = requestArguments.fieldNames,
                                        hasQuery = (requestArguments.queryFieldNames.length);

                                    if (project.loadJson()) { // need all fields
                                        hasQuery = false;
                                        // set all fieldNames from XML to generate its JSON structure
                                        fieldNames = element.getchildren().map((child) => {
                                            return {
                                                name: child.tag
                                            };
                                        });
                                    }

                                    // walk through all the fields and copy value if different
                                    return Promise.each(fieldNames, (field) => {
                                        var xmlField = element.find(field.name);
                                        if (xmlField) {
                                            const value = (nullForEmpty && !xmlField.text) ? null : xmlField.text;
                                            if (xmlField.attrib.display_value) {
                                                file[field.name] = {
                                                    display_value: xmlField.attrib.display_value,
                                                    value: value
                                                };
                                            } else {
                                                file[field.name] = value;
                                            }
                                        }
                                    }).then(() => {

                                        var updatedByField = file.sys_updated_by || file.sys_created_by;
                                        var updatedBy = (typeof updatedByField == 'object') ? (updatedByField.display_value) ? updatedByField.display_value : updatedByField.value : updatedByField;

                                        file = project.appendMeta(file, {
                                            hostName: config.host.name,
                                            className: className,
                                            appName: scope.appName,
                                            scopeName: scope.scopeName,
                                            updatedBy: updatedBy
                                        });

                                    }).then(() => {

                                        // some entities do have a query
                                        if (!hasQuery) {
                                            // add the file to the list
                                            resultUpdateFiles.push(file);
                                            return;
                                        }

                                        //console.log('requestArguments.queryFieldNames, ', requestArguments.queryFieldNames);
                                        var hasDotWalk = requestArguments.queryFieldNames.some((name) => {
                                            return (name.indexOf('.') !== -1);
                                        });
                                        var useQueryParser = false;
                                        if (hasDotWalk || !useQueryParser) { // always do this as there is no parser for the XML in place yet.
                                            // query the original record
                                            var entity = project.getEntity(className);
                                            //console.log(`entity ${className} has query ${entity.query}`);

                                            var query = entity.query.split('^NQ').map((segment) => {
                                                return `sys_id=${sysId}^${segment}`;
                                            }).join('^NQ');

                                            //console.log(`entity ${className} has query ${query} - HOSTNAME ${client.getHostName()}`);

                                            return client.getFilesFromTable({
                                                tableName: className,
                                                options: {
                                                    autoPagination: false,
                                                    qs: {
                                                        sysparm_query: query,
                                                        sysparm_fields: 'sys_id',
                                                        sysparm_limit: 1
                                                    }
                                                }
                                            }).then((results) => {
                                                if (results.length) {
                                                    // add the file to the list as the query does match
                                                    resultUpdateFiles.push(file);
                                                }
                                            });
                                        } else { // take it form the fields
                                            /*
                                                TODO
                                                write SNOW query parser
                                            */
                                        }
                                    });

                                } else if ('DELETE' == action) {
                                    resultDeleteFiles.push({
                                        sysId,
                                        updatedBy: element.findtext('sys_updated_by') || element.findtext('sys_created_by')
                                    });
                                }
                            });
                        });
                    }).then(() => {
                        //console.log("files to be deleted:", resultDeleteFiles)
                        // physically remove the files to be deleted form disc
                        var filesDelete = project.remove(resultDeleteFiles);

                        // physically add new or touched files
                        var filesAdded = Promise.try(() => {
                            var filesOnDisk = [];
                            return Promise.each(resultUpdateFiles, (file) => {
                                return project.save(file).then((filesUpdated) => {
                                    filesOnDisk = filesOnDisk.concat(filesUpdated);
                                });
                            }).then(() => {
                                return filesOnDisk;
                            });
                        });

                        return Promise.all([filesDelete, filesAdded]).then((allResults) => {
                            deletedFiles = deletedFiles.concat(allResults[0]);
                            updatedFiles = updatedFiles.concat(allResults[1]);
                        });
                    });
                });
            });

        }).then(() => {
            /*
            [13:18:41.439] [LOG]   [55835]  add file '/cicd/store/repos/ba51a605-9abb-4b00-ad4e-d60de2a08a4d/sn/Global/_/sys_ui_list_element/11a0f427dbbe67002833b14ffe9619ff.json'
            [13:19:11.999] [LOG]   [55835]  file successfully deleted /cicd/store/repos/ba51a605-9abb-4b00-ad4e-d60de2a08a4d/sn/Global/_/sys_ui_list_element/11a0f427dbbe67002833b14ffe9619ff.json
            */
            // remove all updated files which were deleted later in the update set
            /* TODO:
                for every file check if:
                    on add: remove it from delete
                    on delete: remove it from add
            */
            updatedFiles = updatedFiles.filter((file) => {
                return !deletedFiles.some((delFile) => delFile.sysId == file.sysId);
            })
            return {
                // all files, modified or created in this branch
                updatedFiles: updatedFiles,
                // all files deleted in this branch
                deletedFiles: deletedFiles,
                // all files modified in this branch, regardless if the file existed in e.g. master branch in same version!
                modifiedFiles: updatedFiles.filter((file) => file.modified),
                // all filed that were not changed since the last run
                unchangedFiles: updatedFiles.filter((file) => !file.modified)
            };
        }).then((touchedFiles) => {
            return step(`All files locally created/removed form update-set-xml to branch '${config.branchName}'. Modified: ${touchedFiles.modifiedFiles.length}, Unchanged: ${touchedFiles.unchangedFiles.length}, Deleted: ${touchedFiles.deletedFiles.length}`)
                .then(() => touchedFiles);
        });

    }).then((touchedFiles) => {
        /*
            TODO:
                --> "last commit wins detection"
                    check if files are newer in any other update-set branch
                    check if files are newer in 'master' branch
 
                --> "collision detection"
                    before the local changes are pushed to the origin, 
                    check if any files in 'master' (target) are newer than in the current branch
                
        */
        return touchedFiles;
    }).then((touchedFiles) => { // gulp

        return Promise.try(() => {
            return Promise.try(() => {
                return step('Configure files for Lint');

            }).then(() => { // find all js files
                gulp.lint.files = touchedFiles.updatedFiles.reduce((prev, file) => {
                    if (file.path.endsWith('.js')) {
                        prev.push(path.relative(config.application.dir.code, file.path));
                    }
                    return prev;
                }, []);

                if (gulp.lint.files.length === 0)
                    gulp.lint.files.push('./sn/**/*.js'); // to ensure the lint process does not fail in case of no files created.
            }).then(() => {
                return step('Save Lint information to DB');
            }).then(() => { // update db
                return self.db.run.update(run);
            });
        }).then(() => {
            return Promise.try(() => {
                return step('Assign ATF Test-Suites and Tests');
            }).then(() => {
                gulp.test.title = `${config.application.name} - ${config.updateSet.name}`;

            }).then(() => {
                if (!config.atf.updateSetOnly)
                    return;
                /*
                    in case of only a test_step was captured in an update-set
                    but not it's test object. 
                */
                return project.getTestSteps(config.branchName).then((testSteps) => {
                    const testStepSysIds = testSteps.map((step) => {
                        return step.sysId;
                    });

                    return self.getTestsFromTestStep(config, testStepSysIds).then((tests) => {
                        gulp.test.tests = (gulp.test.tests || []).concat(tests.map((test) => test.sysId)).filter((elem, pos, arr) => {
                            return arr.indexOf(elem) == pos; // remove duplicates
                        });
                    });
                });

            }).then(() => { // assign all testSuites to atf obj
                return Promise.try(() => {
                    return (config.atf.updateSetOnly) ? project.getTestSuites(config.branchName) : self.getApplicationTestSuites(config);
                }).then((testSuites) => {
                    gulp.test.suites = testSuites.map((suite) => {
                        return suite.sysId;
                    });
                });
            }).then(() => { // assign all tests to atf obj

                return Promise.try(() => {
                    return (config.atf.updateSetOnly) ? project.getTests(config.branchName) : self.getApplicationTests(config);
                }).then((tests) => {

                    // safe the whole list first
                    gulp.test.tests = (gulp.test.tests || []).concat(tests.map((test) => test.sysId)).filter((elem, pos, arr) => {
                        return arr.indexOf(elem) == pos; // remove duplicates
                    });

                    if (gulp.test.tests.length) { // get all tests which are assigned to a Suite

                        return client.getAllTestInSuites().then((files) => {
                            var assignedTests = files.reduce((prev, file) => {
                                return prev.concat(file.test);
                            }, []);

                            // remove all test from the config which are part of a Suite
                            gulp.test.tests = gulp.test.tests.filter((test) => {
                                return assignedTests.indexOf(test) === -1;
                            });
                        });
                    }
                });
            }).then(() => {
                return step('Save ATF information to DB');
            }).then(() => { // update db
                return self.db.run.update(run);
            });
        }).then(() => {
            return Promise.try(() => {
                gulp.doc.config.opts.destination = null;
                gulp.doc.config.templates.systemName = config.application.name;
                if (gulp.doc.config.source.include)
                    delete gulp.doc.config.source.include;
            }).then(() => {
                return step('Save DOC information to DB');
            }).then(() => {
                return self.db.run.update(run);
            });
        }).then(() => touchedFiles);

    }).then((touchedFiles) => { // git
        if (!config.git.enabled)
            return;

        return Promise.try(() => {
            return step('add files and commit to git');
        }).then(() => { // group deletedFiles by user and commit individually   
            return Promise.try(() => {
                return step(`'${touchedFiles.deletedFiles.length}' files are deleted.`);
            }).then(() => {
                return self.getFilesByUpdatedBy(touchedFiles.deletedFiles).then((deletedFilesByUpdatedBy) => { // sort deleted files update by user

                    // add and commit per user    
                    return Promise.each(Object.keys(deletedFilesByUpdatedBy), (updatedBy) => {

                        return step(`Commit deleted files for: '${updatedBy}'`).then(() => {
                            // delete files per User

                            return Promise.each(deletedFilesByUpdatedBy[updatedBy], (removedFile) => {
                                return git.exec({
                                    quiet: true,
                                    args: `add -u "${removedFile}"` // requires GIT >= v2.0
                                }).catch(() => {
                                    // ignore if file does not exist locally
                                });
                            });
                            //return git.delete(deletedFilesByUpdatedBy[updatedBy]);

                        }).then(() => {
                            return self.getUser(client, updatedBy);
                        }).then((user) => {
                            // commit all files per User
                            return git.commit({
                                author: {
                                    email: user.email,
                                    name: user.name
                                },
                                messages: [`Deleted files by '${user.name}' on '${config.updateSet.name}' -- Build #${config.build.sequence}`] // , config.updateSet.description
                            });
                        });
                    });
                });
            });

        }).then(() => { // group modifiedFiles by user and commit individually
            return Promise.try(() => {
                return step(`'${touchedFiles.modifiedFiles.length}' files have changed.`);
            }).then(() => {
                return self.getFilesByUpdatedBy(touchedFiles.modifiedFiles); // sort updated files update by user
            }).then((filesByUpdatedBy) => {
                // add and commit per user    
                return Promise.each(Object.keys(filesByUpdatedBy), (updatedBy) => {

                    return step(`Commit for: '${updatedBy}'`).then(() => {
                        // add files per User
                        return git.add(filesByUpdatedBy[updatedBy]).then((added) => {
                            logger.log('GIT files added', added.length);
                        });
                    }).then(() => {
                        return self.getUser(client, updatedBy);
                    }).then((user) => {
                        // commit all files per User
                        return git.commit({
                            author: {
                                email: user.email,
                                name: user.name
                            },
                            messages: [`Changes by '${user.name}' on '${config.updateSet.name}' -- Build #${config.build.sequence}`] // , config.updateSet.description
                        });
                    });
                });
            });

        }).then(() => { // remove all missing files and commit (sys_update_xml records manually deleted form sys_update_set)
            return Promise.try(() => {
                // all files in the update-set
                return project.removeMissing(touchedFiles.updatedFiles.map((file) => file.sysId), (filePath) => {
                    // use git to delete. removeMissing() requires a true to proceed correctly.
                    return fs.exists(filePath).then((exists) => {
                        if (exists)
                            return git.delete(filePath);
                    }).then(() => true);
                });
            }).then((removedFiles) => {
                return Promise.try(() => {
                    return step(`'${removedFiles.length}' files have been (manually) removed from '${config.updateSet.name}'`);
                }).then(() => {
                    if (removedFiles.length) {
                        return Promise.try(() => {
                            return step(`'Commit '${removedFiles.length}' changes`);
                        }).then(() => {
                            return git.commit({
                                messages: [`'${removedFiles.length}' files (manually) removed from '${config.updateSet.name}' on ${config.master.host.name}`]
                            });
                        });
                    }
                });
            });

        }).then(() => {
            // ensure all files are handled and stage is clean
            return git.exec({
                quiet: true,
                args: `add -A` // git add ., git add -u .requires GIT >= v2.0
            }).then(() => {
                return git.commit({
                    messages: [`Clean-up commit.`]
                });
            })
        }).then(() => {
            return git.getLastCommitId().then((id) => {

                // make sure the commitId is only assigned to one last run
                return self.db.run.find({
                    _id: { $ne: run._id },
                    usId: run.usId,
                    commitId: id
                }).then((runs) => { // past runs with same commitId
                    if (!runs || !runs.length)
                        return;
                    return Promise.each(runs, (run) => {
                        run.commitId = `_${run.commitId}`;
                        return self.db.run.update(run);
                    })
                }).then(() => {
                    run.commitId = config.build.commitId = id;
                    return self.db.run.update(run);
                });

            });
        }).then(() => {
            //return project.setConfig(build);
        }).then(() => {
            return git.push(config.branchName);
        });

    });

};
