const Promise = require('bluebird');
const path = require("path");
const fs = require("fs-extra");



module.exports = async function () {
    const self = this;

    if ('mongo' != self.settings.dataStore.type) // no mongo, no migration
        return;

    // check if the server ever run with NeDB files
    const nedbExists = Object.keys(self.dataStore).some(async (collection) => await fs.pathExists(path.join(self.settings.dataStore.path, `${collection}.db`)));
    if (!nedbExists) // no NeDB files found. no need to migrate to mongo as already on mongo
        return;

    const _migrationState = await self.db.__migration.findOneAsync({});
    if (_migrationState && _migrationState.completed) // no need to migrate to mongo as already migrated
        return;

    console.log("******************** Migrating NeDB to MongoDB ********************");

    const PROGRESS = 200;

    const Datastore = require('nedb');
    let nedbDataStore = {};
    Object.keys(self.dataStore).forEach((collection) => {
        const coll = new Datastore({
            filename: path.join(self.settings.dataStore.path, `${collection}.db`),
            autoload: true
        });
        Promise.promisifyAll(coll);
        nedbDataStore[collection] = coll;
    });

    // migrate form NeDB to MongoDB
    const ObjectID = require('mongoose').mongo.ObjectID;
    const _migration = _migrationState || new self.db.__migration();
    await _migration.save();

    const cache = {
        application: new Map(),
        us: new Map(),
        run: new Map(),
    }


    const getApplication = (_oldId) => {
        return Promise.try(() => {
            const app = cache.application.get(_oldId);
            if (app)
                return app;

            return self.db.application.findOne({ _old_id: _oldId }).then((rec) => {
                cache.application.set(_oldId, rec);
                return rec;
            });
        });
    }

    const getUs = (_oldId) => {
        return Promise.try(() => {
            const app = cache.us.get(_oldId);
            if (app)
                return app;

            return self.db.us.findOne({ _old_id: _oldId }).then((rec) => {
                cache.us.set(_oldId, rec);
                return rec;
            });
        });
    }
    const getRun = (_oldId) => {
        return Promise.try(() => {
            const app = cache.run.get(_oldId);
            if (app)
                return app;

            return self.db.run.findOne({ _old_id: _oldId }).then((rec) => {
                cache.run.set(_oldId, rec);
                return rec;
            });
        });
    }

    return Promise.try(() => {
        console.log('migrate application records....')
        return nedbDataStore.application.findAsync({ __migrated: { $exists: false } }).then((appList) => {
            if (appList.length == 0)
                return console.log('no application records left to migrate');

            let insertsNum = 0;
            return Promise.each(appList, (app) => {
                const newId = new ObjectID();

                app._old_id = app._id;
                app.id = app._id;
                app._id = newId;

                //delete app.id;

                return self.db.application.insert(app).then(() => {
                    insertsNum++;

                    if (insertsNum % PROGRESS == 0)
                        console.log(".... ", insertsNum);

                    return nedbDataStore.application.updateAsync({ _id: app._old_id }, { $set: { __migrated: true } });
                });
            }).then(async () => {

                _migration.set({ application: insertsNum });
                await _migration.save();

                console.log(`${insertsNum} applications migrated`);
                nedbDataStore.application = null;
            });
        });
    }).then(() => {
        console.log('migrate us records....')
        return nedbDataStore.us.findAsync({ __migrated: { $exists: false } }).then((usList) => {
            if (usList.length == 0)
                return console.log('no update set records left to migrate');

            let insertsNum = 0;
            return Promise.each(usList, (us) => {

                const newId = new ObjectID();

                us._old_id = us._id;
                us._id = newId;

                us._old_runId = us.runId;
                us.runId = null;

                us._old_appId = us.appId;
                return getApplication(us.appId).then((app) => {
                    if (!app) {
                        delete us.appId;
                        return console.error("us : no appId found for ", us.appId)
                    }
                    us.appId = app._id;
                }).then(() => {
                    return self.db.us.insert(us);
                }).then(() => {
                    insertsNum++;
                    if (insertsNum % PROGRESS == 0)
                        console.log(".... ", insertsNum);
                    return nedbDataStore.us.updateAsync({ _id: us._old_id }, { $set: { __migrated: true } });
                })
                /*
                us.appId = keyMap.application.get(us.appId)
                if (!us.appId)
                    console.error("us : no appId found for ", us.appId);
                */

            }).then(async () => {
                _migration.set({ us: insertsNum });
                await _migration.save();

                console.log(`${insertsNum} update sets migrated`);
                nedbDataStore.us = null;
            })
        });
    }).then(() => {
        console.log('migrate run records....');
        return nedbDataStore.run.findAsync({ __migrated: { $exists: false } }).then((runList) => {
            if (runList.length == 0)
                return console.log('no run records left to migrate');

            let insertsNum = 0;
            return Promise.each(runList, (run) => {

                const newId = new ObjectID();

                run._old_id = run._id;
                run._id = newId;
                run._old_testId = run.testId;
                delete run.testId;



                return getApplication(run.appId).then((_app) => {
                    if (!_app) {
                        delete run.appId;
                        return console.error("run : no appId found for ", run.appId);
                    }
                    run.appId = _app._id;
                }).then(() => {
                    return getUs(run.usId).then((_us) => {
                        if (!_us) {
                            delete run.usId;
                            return console.error("run : no usId found for ", run.usId);
                        }
                        run.usId = _us._id;
                    });
                }).then(() => {
                    if (run.config && run.config.build) {
                        if (run.usId) {
                            run.config.build.usId = run.usId;
                        }
                        run.config.build.runId = run._id;
                    }

                    return self.db.run.insert(run)
                }).then(() => {
                    insertsNum++;
                    if (insertsNum % PROGRESS == 0)
                        console.log(".... ", insertsNum);

                    return nedbDataStore.run.updateAsync({ _id: run._old_id }, { $set: { __migrated: true } });
                })

            }).then(() => {
                return self.db.us.find({}).then((usList) => {
                    return Promise.each(usList, (us) => {
                        if (!us._old_runId)
                            return;
                        return getRun(us._old_runId).then((run) => {
                            if (!run) {
                                delete us.runId;
                                return console.error("run : no us found for run._old_id ", us._old_runId);
                            }

                            us.runId = run._id;
                            return self.db.us.update(us);
                        })
                    })
                })

            }).then(async () => {
                _migration.set({ run: insertsNum });
                await _migration.save();

                console.log(`${insertsNum} runs migrated`);
                nedbDataStore.run = null;
            })
        });
    }).then(() => {
        console.log('migrate step records....');
        return nedbDataStore.step.findAsync({ __migrated: { $exists: false } }).then((stepList) => {
            if (stepList.length == 0)
                return console.log('no step records left to migrate');

            let insertsNum = 0;
            return Promise.each(stepList, (step) => {

                step._old_id = step._id;
                delete step._id;

                return getRun(step.runId).then((_run) => {
                    if (!_run) {
                        delete step.runId;
                        return console.error("step : no runId found for ", step.runId);
                    }
                    step.runId = _run._id;

                }).then(() => {
                    return self.db.step.insert(step)
                }).then(() => {
                    insertsNum++;
                    if (insertsNum % PROGRESS == 0)
                        console.log(".... ", insertsNum);

                    return nedbDataStore.step.updateAsync({ _id: step._old_id }, { $set: { __migrated: true } });
                })


            }).then(async () => {
                _migration.set({ step: insertsNum });
                await _migration.save();

                console.log(`${insertsNum} steps migrated`);
                nedbDataStore.step = null;
            })
        });
    }).then(() => {
        console.log('migrate deployment records....')
        return nedbDataStore.deployment.findAsync({ __migrated: { $exists: false } }).then((deploymentList) => {
            if (deploymentList.length == 0)
                return console.log('no deployment records left to migrate');

            console.log(`${deploymentList.length} deployments to be migrated`);

            let insertsNum = 0;
            return Promise.each(deploymentList, (deployment) => {

                deployment._old_id = deployment._id;
                deployment._old_appId = deployment.appId;
                deployment._old_usId = deployment.usId;
                deployment._old_runId = deployment.runId;
                delete deployment._id;

                return getApplication(deployment.appId).then((_app) => {
                    if (!_app) {
                        console.error("deployment : no appId found for ", deployment.appId);
                        delete deployment.appId;
                        return
                    }
                    deployment.appId = _app._id;
                }).then(() => {
                    return getUs(deployment.usId).then((_us) => {
                        if (!_us) {
                            console.error("deployment : no usId found for ", deployment.usId);
                            delete deployment.usId;
                            return
                        }
                        deployment.usId = _us._id;
                    });
                }).then(() => {
                    return getRun(deployment.runId).then((_run) => {
                        if (!_run) {
                            console.error("deployment : no runId found for ", deployment.runId);
                            delete deployment.runId;
                            return
                        }
                        deployment.runId = _run._id;
                    });
                }).then(() => {
                    return self.db.deployment.insert(deployment)
                }).catch((e) => {
                    console.error("ERROR ON RECORD %j", deployment);
                    throw e;
                }).then(() => {
                    insertsNum++;
                    if (insertsNum % PROGRESS == 0)
                        console.log(".... ", insertsNum);
                    return nedbDataStore.deployment.updateAsync({ _id: deployment._old_id }, { $set: { __migrated: true } });
                });

            }).then(async () => {
                _migration.set({ deployment: insertsNum });
                await _migration.save();

                console.log(`${insertsNum} deployments migrated`);
                nedbDataStore.deployment = null;
            });
        });
    }).then(() => {
        console.log('migrate test records....')
        return nedbDataStore.test.findAsync({ __migrated: { $exists: false } }).then((testList) => {
            if (testList.length == 0)
                return console.log('no test records left to migrate');

            let insertsNum = 0;
            return Promise.each(testList, (test) => {

                test._old_id = test._id;
                delete test._id;

                test.onHost = test.on;
                delete test.on;

                test._old_appId = test.appId;
                test._old_usId = test.usId;
                test._old_runId = test.runId;

                return getApplication(test.appId).then((_app) => {
                    if (!_app) {
                        console.error("test : no appId found for ", test.appId);
                        delete test.appId;
                        return
                    }
                    test.appId = _app._id;
                }).then(() => {
                    return getUs(test.usId).then((_us) => {
                        if (!_us) {
                            console.error("test : no usId found for ", test.usId);
                            delete test.usId;
                            return;
                        }
                        test.usId = _us._id;
                    });
                }).then(() => {
                    return getRun(test.runId).then((_run) => {
                        if (!_run) {
                            console.error("test : no runId found for ", test.runId);
                            delete test.runId;
                            return
                        }
                        test.runId = _run._id;
                    });
                }).then(() => {
                    return self.db.test.insert(test)

                }).then(({ _id }) => {
                    insertsNum++;
                    if (insertsNum % PROGRESS == 0)
                        console.log(".... ", insertsNum);

                    return self.db.run.findOne({ _old_testId: test._old_id }).then((_run) => {
                        if (!_run)
                            return console.error("test : run not found with _old_testId ", test._old_id);
                        _run.testId = _id;
                        return self.db.run.update(_run)
                    })
                }).then(() => {
                    return nedbDataStore.test.updateAsync({ _id: test._old_id }, { $set: { __migrated: true } });
                });

            }).then(async () => {
                _migration.set({ test: insertsNum });
                await _migration.save();

                console.log(`${insertsNum} tests migrated`);
                nedbDataStore.test = null;
            });
        });
    }).then(async () => {


        const projectsDir = path.join(self.settings.dataStore.path, 'projects');
        if (! await fs.exists(projectsDir))
            return;

        const projectFiles = await fs.readdir(projectsDir);

        return Promise.each(projectFiles, async (file) => {
            const fArr = file.split(".");
            const isDb = (fArr.length > 0 && fArr[1] === 'db');
            if (!isDb)
                return;

            const name = fArr[0];

            console.log('migrating filesystem of project', name);

            const fullPath = path.join(self.settings.dataStore.path, 'projects', `${name}.db`);
            let splitDbFiles = [fullPath];

            // check the size
            const fileStat = await fs.stat(fullPath);
            const heapSize = require('v8').getHeapStatistics().heap_size_limit;

            console.log(fileStat.size, heapSize, heapSize - fileStat.size);

            if (fileStat.size > 1000000000 || fileStat.size > (heapSize * .75)) {
                console.log("splitting file", fullPath)

                console.log("cleaning split dir");
                await fs.emptyDir(path.join(self.settings.dataStore.path, 'projects_split'));

                splitDbFiles = await new Promise((resolve, reject) => {
                    var readStream = fs.createReadStream(fullPath);
                    const split2 = require('split2');
                    const MAX_LINES = 100000;
                    let line = MAX_LINES;
                    let file = 0;
                    let writeStream;
                    const fileNames = [];
                    readStream.pipe(split2())
                        .on('data', function (data) {
                            if (line >= MAX_LINES) {
                                file++;
                                line = 0;
                                if (writeStream)
                                    writeStream.end();

                                let fileName = path.join(self.settings.dataStore.path, 'projects_split', `${name}-${file}.db`);
                                fileNames.push(fileName);
                                fs.ensureFileSync(fileName);
                                console.log("writing into file ", fileName);
                                writeStream = fs.createWriteStream(fileName);
                            }

                            writeStream.write(`${data}\n`, 'UTF-8');
                            line++;
                        }).on('end', () => {
                            writeStream.end();
                            resolve(fileNames)
                        }).on('error', (error) => {
                            reject(error);
                        });
                });
            }

            let insertsNum = 0;
            return Promise.each(splitDbFiles, async (splitFile) => {
                let coll = new Datastore({
                    filename: splitFile,
                    autoload: true
                });
                Promise.promisifyAll(coll);

                await self.db.registerDataStore(name);

                console.log('migrating file', splitFile);

                const projectModel = self.db[name];
                return coll.findAsync({ __migrated: { $exists: false } }).then((projectList) => {

                    if (projectList.length == 0)
                        return console.log('no project records left to migrate');

                    console.log('project files to be migrated', projectList.length);

                    return Promise.each(projectList, (project) => {
                        //console.log('project', project);

                        let _old_id = project._id;
                        project.sysId = project._id;
                        delete project._id;

                        //console.log('name', name);
                        //console.dir(project, { colors: true, depth: null })

                        // model.createAsync
                        return projectModel.insertAsync(project).then(() => {
                            insertsNum++
                            if (insertsNum % PROGRESS == 0)
                                console.log(".... ", insertsNum);

                            return coll.updateAsync({ _id: _old_id }, { $set: { __migrated: true } }).catch((e) => {
                                console.error(e);

                                if (stats.size < 1000000000 && stats.size < (require('v8').getHeapStatistics().heap_size_limit * .75)) return;
                            });
                        });

                    }).then(async () => {
                        _migration.set({ projects: { [name]: insertsNum } });
                        await _migration.save();

                        console.log(`${insertsNum} files migrated for project ${name}\n`);
                        coll = undefined;
                    })
                });

            })

        });


    }).then(() => {
        nedbDataStore = undefined;
        _migration.set({ completed: true });
        return _migration.save();
    }).then(() => {

        const target = path.resolve(self.settings.dataStore.path, `../db_archive-${Math.floor(Math.random() * 100)}`);
        console.log(`archiving NeDB collection dir from ${self.settings.dataStore.path} to ${target}`);

        return fs.move(self.settings.dataStore.path, target)

    }).then(() => {
        console.log("******************** MongoDB migration completed ********************");
    });
}
