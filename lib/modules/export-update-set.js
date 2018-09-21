const Promise = require('bluebird');
const path = require("path");
const etparse = require('elementtree').parse;

module.exports = function (ctx) {
    const self = this;
    const config = ctx.config;

    const build = config.build.run.us.build;

    let project, client, git;

    const step = (message, error) => {
        return self.addStep(config, `${path.basename(__filename).split('.')[0]} : ${message}`, error);
    };
    
    return Promise.try(() => {
        project = self.getProject(config);
        client = self.getClient(config);
        git = self.getGit(ctx);

        return self.build.setProgress(ctx, this.build.IN_PROGRESS);

    }).then(() => {
        if (config.application.git.enabled === true) {
            return Promise.try(() => {
                return step(`GIT pull from remote`);
            }).then(() => {
                return git.pull();
            }).then(() => {
                return step(`GIT switch to branch ${config.branchName}`);
            }).then(() => {
                return git.switchToBranch(config.branchName);
            }).then(() => {
                //return git.reset('master', true);
            }).then(() => {
                /*
                return git.pull('--all').catch((e) => { 
                    console.log(e);
                });
                */
            }).then(() => { 
                return step(`GIT merge with master`);
            }).then(() => { // merge with master
                return git.merge('master').catch(() => {
                    return Promise.try(() => {
                        return step(`GIT merge failed, undo and reset from master.`);
                    }).then(() => {
                        return git.exec({
                            args: 'merge --abort',
                            quiet: false
                        });
                    }).then(() => {
                        return step("reset SOFT from master");
                    }).then(() => {
                        return git.exec({
                            quiet: false,
                            args: 'reset --soft master'
                        });
                    });
                });
            });
        }
    }).then(() => { // export update-set-xml 
        var updatedFiles = [];
        var deletedFiles = [];

        return Promise.try(() => {
            return step(`export update-set '${config.updateSet.sys_id}'`);

        }).then(() => {
            return client.getUpdateSetFiles(config.updateSet.sys_id, (results) => {
                // process page-by-page
                return Promise.each(results, (result) => {

                    var resultUpdateFiles = [];
                    var resultDeleteFiles = [];

                    return Promise.try(() => { // parse the XML payload
                        return etparse(result.payload);
                    }).then((xmlTree) => { // find all tables, action and sysId in the payload
                        return Promise.each(xmlTree.findall('.//*[@action]'), (element) => {

                            var className = element.tag,
                                sysId = element.findtext('sys_id');

                            /*
                                only process payload if the entity is of interest
                            */
                            if (sysId && className && project.hasEntity(className)) {

                                if ('INSERT_OR_UPDATE' == element.attrib.action) {
                                    // get a list of params used with this entity type
                                    var file = {},
                                        requestArguments = project.getEntityRequestParam(className),
                                        fieldNames = requestArguments.fieldNames,
                                        hasQuery = (requestArguments.queryFieldNames.length);

                                    if (!project.getEntity(className)) { // in this case the 'includeUnknownEntities' is true
                                        hasQuery = false;
                                        // set all fieldNames from XML to generate its JSON structure
                                        fieldNames = element.getchildren().map((child) => {
                                            return child.tag;
                                        });
                                    }

                                    // walk through all the fields and copy value if different
                                    return Promise.each(fieldNames, (field) => {
                                        var xmlField = element.find(field.name);
                                        if (xmlField) {
                                            if (xmlField.attrib.display_value) {
                                                file[field.name] = {
                                                    display_value: xmlField.attrib.display_value,
                                                    value: xmlField.text
                                                };
                                            } else {
                                                file[field.name] = xmlField.text;
                                            }
                                        }
                                    }).then(() => {

                                        var updatedByField = file.sys_updated_by || file.sys_created_by;
                                        var updatedBy = (typeof updatedByField == 'object') ? (updatedByField.display_value) ? updatedByField.display_value : updatedByField.value : updatedByField;

                                        file.____ = {
                                            hostName: config.host.name,
                                            className: className,
                                            appName: config.updateSet.appName,
                                            scopeName: config.updateSet.scopeName,
                                            updatedBy: updatedBy,
                                            src: config.branchName
                                        };

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
            }).then(() => {
                return step(`all files locally created/removed form update-set-xml`);
            });
            
        }).then(() => {
            return {
                updatedFiles: updatedFiles,
                deletedFiles: deletedFiles
            };
        });

    }).then((files) => {
        
        return Promise.try(() => {
            return step('Configure files for Lint');

        }).then(() => { // find all js files
        
             build.lint.files = files.updatedFiles.reduce((prev, file) => {
                if (file.path.endsWith('.js')) {
                    prev.push(path.relative(config.build.run.us.config.application.dir.code, file.path));
                }
                return prev;
            }, []);

            if (build.lint.files.length === 0)
                build.lint.files.push('./sn/'); // to ensure the lint process does not fail in case of no files created.
        }).then(() => {
            return step('Save Lint information to DB');
        }).then(() => { // update db
            return self.db.us.update(config.build.run.us);
        }).then(() => files);
        
    }).then((files) => {
        
        return Promise.try(() => {
            return step('Assign ATF Test-Suites and Tests');

        }).then(() => { // assign all testSuites to atf obj
            return Promise.try(() => { 
                return (config.atf.updateSetOnly) ? project.getTestSuites(config.branchName) : this.getApplicationTestSuites(ctx);
            }).then((testSuites) => {
                build.test.suites = testSuites.map((suite) => {
                    return suite.sysId;
                });
            });
        }).then(() => { // assign all tests to atf obj
            return Promise.try(() => {
                return (config.atf.updateSetOnly) ? project.getTests(config.branchName) : this.getApplicationTests(ctx);
            }).then((tests) => {

                // safe the whole list first
                build.test.tests = tests.map((test) => {
                    return test.sysId;
                });

                if (build.test.tests.length) { // get all tests which are assigned to a Suite
                    
                    return client.getAllTestInSuites().then((files) => {
                        var assignedTests = files.reduce((prev, file) => {
                            return prev.concat(file.test);
                        }, []);

                        // remove all test from the config which are part of a Suite
                        build.test.tests = build.test.tests.filter((test) => {
                            return assignedTests.indexOf(test) === -1;
                        });
                    });
                }
            });
        }).then(()=>{
            return step('Save ATF information to DB');
        }).then(()=>{ // update db
            return self.db.us.update(config.build.run.us);
        }).then(() => files);

    
    }).then((files) => {
        /* TODO: 
            - read files/ settings from sn-cicd project (not form sn-project)

        */
        return Promise.try(() => {
            return project.readFile('./config/jsdoc.json').then((raw) => {
                return JSON.parse(raw);
            }).catch(() => {
                return {
                    opts: {},
                    templates: {},
                    source: {
                        include : []
                    }
                };
            });
        }).then((jsdoc) => {
            jsdoc.opts.destination = null; // path.resolve(config.application.dir.doc, 'docs');
            jsdoc.templates.systemName = config.application.name;
            if (jsdoc.source.include)
                delete jsdoc.source.include;
            build.doc.config = jsdoc;

        }).then(() => {
            return project.readFile('./config/eslint.json').then((raw) => {
                return JSON.parse(raw);
            }).catch(() => {return {};});
        }).then((eslint) => {
            build.lint.config = eslint;

        }).then(() => {
            build.test.title = `${config.application.name} - ${config.updateSet.name}`;

        }).then(() => {
            return self.db.us.update(config.build.run.us);
        }).then(() => {
            return project.setConfig(build);
        }).then(() => files);
    
    }).then((files) => {
        if (!config.application.git.enabled)
            return;

        return Promise.try(() => {
            return step('add files and commit to git');
        }).then(() => {
            /*
             *   an alternative to only have one commit per update set
             *
             
            // delete all old files
            return git.delete(files.deletedFiles.map((file) => file.path)).then(() => {
                // to only have one commit
                return git.commit({
                    author: {
                        email: config.build.requestor.email,
                        name: config.build.requestor.fullName
                    },
                    messages: [`DELETED FILES: ${config.updateSet.name} - Build #${config.build.sequence}`, config.updateSet.description]
                });
            });
            */
        }).then(() => {
            /*
             *   an alternative to only have one commit per update set
             *
             
            // git add all files
            return git.add(files.updatedFiles.map((file) => file.path)).then(() => {
                // to only have one commit
                return git.commit({
                    author: {
                        email: config.build.requestor.email,
                        name: config.build.requestor.fullName
                    },
                    messages: [`${config.updateSet.name} - Build #${config.build.sequence}`, config.updateSet.description]
                });
            });
            */
        }).then(() => {
            /*
                group deletedFiles by user and commit individually
            */
            return self.getFilesByUpdatedBy(files.deletedFiles).then((fileByUpdatedBy) => { // sort deleted files update by user

                // add and commit per user    
                return Promise.each(Object.keys(fileByUpdatedBy), (updatedBy) => {

                    // delete files per User
                    return git.delete(fileByUpdatedBy[updatedBy]).then(() => {
                        return self.getUser(client, updatedBy);
                    }).then((user) => {
                        // commit all files per User
                        return git.commit({
                            author: {
                                email: user.email,
                                name: user.name
                            },
                            messages: [`DELETED FILES: ${config.updateSet.name} - Build #${config.build.sequence}`, config.updateSet.description]
                        });
                    });
                });
            });
        }).then(() => {
            /*
                group updatedFiles by user and commit individually
            */
            return self.getFilesByUpdatedBy(files.updatedFiles).then((fileByUpdatedBy) => { // sort updated files update by user

                // add and commit per user    
                return Promise.each(Object.keys(fileByUpdatedBy), (updatedBy) => {

                    // add files per User
                    return git.add(fileByUpdatedBy[updatedBy]).then(() => {
                        return self.getUser(client, updatedBy);
                    }).then((user) => {
                        // commit all files per User
                        return git.commit({
                            author: {
                                email: user.email,
                                name: user.name
                            },
                            messages: [`${config.updateSet.name} - Build #${config.build.sequence}`, config.updateSet.description]
                        });
                    });
                });
            });

        }).then(() => {
            return git.getLastCommitId().then((id) => {
                config.build.run.us.commitId = id;
                return self.db.us.update(config.build.run.us);
            });
        }).then(() => {
            return project.setConfig(build);
        }).then(() => {
            return git.push();
        });    
        
    });

};