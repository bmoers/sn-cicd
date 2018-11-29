const Promise = require('bluebird');
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
        return self.getProject(config, config.branchName).then((_project) => {
            project = _project;
        });
    }).then(() => {
        gulp = assign({}, self.settings.buildConfig.gulp);
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
                TODO: 
                    - alert user as this means a file in service-now was changed after the record
                        was caputred in the update-set -> AND it has unresolvable collisions (same line)!
                    - get the file name from the 'git status' command
                    - add a feature switch to controll this behaviour better
                */
                return git.merge(config.master.name).catch((e) => { // try to merge with master
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
            return project.writeFile(['us', config.updateSet.scopeName, updateSet.name], updateSet.content);
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
                        if (nullForEmpty) // add nill attribute to empty tags
                            result.payload = result.payload.replace(/<([^\/>]*)\/>/g, `<$1 xsi:nil="true"/>`).replace(/<([^\s\/>]*)[^>]*><\/(\1)>/g, `<$1 xsi:nil="true"/>`);
                        return etparse(result.payload);
                    }).then((xmlTree) => { // find all tables, action and sysId in the payload
                        return Promise.each(xmlTree.findall('.//*[@action]'), (element) => {
 
                            var className = element.tag,
                                sysId = element.findtext('sys_id');
                            
                            /*
                                only process payload if the entity is of interest
                            */
                            if (sysId && className && project.loadEntity(className)) {

                                if ('INSERT_OR_UPDATE' == element.attrib.action) {
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
                                            const value = (nullForEmpty && xmlField.attrib['xsi:nil'] == 'true') ? null : xmlField.text;
                                            
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
                                            appName: config.updateSet.appName,
                                            scopeName: config.updateSet.scopeName,
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

                                } else if ('DELETE' == element.attrib.action) {
                                    resultDeleteFiles.push(sysId);
                                }
                            } else {
                                //console.dir(element, { depth: null, colors: true });
                            }
                        });
                    }).then(() => {

                        var filesDelete = project.remove(resultDeleteFiles).then((files) => {
                            return files.map((delFile) => { // put into the same format
                                return {
                                    path: delFile
                                };
                            });
                        });

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
                            updatedFiles = updatedFiles.concat(allResults[1]);
                            deletedFiles = deletedFiles.concat(allResults[0]);
                        });
                    });
                });
            });
            
        }).then(() => {
            return {
                updatedFiles: updatedFiles,
                deletedFiles: deletedFiles,
                modifiedFiles : updatedFiles.filter((file) => file.modified)
            };
        }).then((touchedFiles) => {
            return step(`All files locally created/removed form update-set-xml. Touched: ${touchedFiles.updatedFiles.length}, Modified: ${touchedFiles.modifiedFiles.length}, Deleted: ${touchedFiles.deletedFiles.length}`)
            .then(()=> touchedFiles );
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

            }).then(() => { // assign all testSuites to atf obj
                return Promise.try(() => {
                    return (config.atf.updateSetOnly) ? project.getTestSuites(config.branchName) : this.getApplicationTestSuites(config);
                }).then((testSuites) => {
                    gulp.test.suites = testSuites.map((suite) => {
                        return suite.sysId;
                    });
                });
            }).then(() => { // assign all tests to atf obj
                return Promise.try(() => {
                    return (config.atf.updateSetOnly) ? project.getTests(config.branchName) : this.getApplicationTests(config);
                }).then((tests) => {

                    // safe the whole list first
                    gulp.test.tests = tests.map((test) => {
                        return test.sysId;
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
                return self.getFilesByUpdatedBy(touchedFiles.deletedFiles).then((fileByUpdatedBy) => { // sort deleted files update by user

                    // add and commit per user    
                    return Promise.each(Object.keys(fileByUpdatedBy), (updatedBy) => {

                        return step(`Commit for: '${updatedBy}'`).then(() => {
                            // delete files per User
                            return git.delete(fileByUpdatedBy[updatedBy]).then(() => {
                                return self.getUser(client, updatedBy);
                            });
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
            }).then((fileByUpdatedBy) => {
                // add and commit per user    
                return Promise.each(Object.keys(fileByUpdatedBy), (updatedBy) => {

                    return step(`Commit for: '${updatedBy}'`).then(() => { 
                        // add files per User
                        return git.add(fileByUpdatedBy[updatedBy]).then(() => {
                            return self.getUser(client, updatedBy);
                        });
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
                    return git.delete(filePath).then(() => true);
                }); 
            }).then((removedFiles) => {
                return Promise.try(() => {
                    return step(`'${removedFiles.length}' files have been (manually) removed from '${config.updateSet.name}'!'.`);
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