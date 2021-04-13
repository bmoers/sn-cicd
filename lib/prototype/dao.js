
const path = require('path');
const Promise = require('bluebird');
const assign = require('object-assign-deep');

module.exports = function () {
    const self = this;

    /*

        TODO!!!!!!!!!!!
            currently the DB only supports the file to be in ONE version/ update-set
            - a file which is loaded from an update set has a newer timestamp than from master [OK]
            - what if the same file is also in another update set (of the same app)?
                - in that case the branch field must contain a updateOn value
                {
                    "branch": { 
                        "master" : 1540995225000, 
                        "va-test-@07cdc464dbd167c0432cfc600f9619e7" : 1538399625000
                        }
                    }

    */

    const detectCollision = function (applicationId, branch) {
        const newerFiles = [];
        return registerDataStore(applicationId).then(() => {
            const db = self.dataStore[applicationId];
            if (!db)
                return;

            // get all files from the current project
            return db.findAsync({ branch: branch }).then((files) => {
                if (!files.length)
                    return;
                /*
                    TODO: also search in the current applications for files in other branches!
                */
                return self.dataStore.application.findAsync({ _id: { $ne: applicationId } }).then((applications) => {
                    // check every app DB if there are newer files
                    return Promise.each(applications, ({ _id }) => {

                        return registerDataStore(_id).then(() => {
                            const appDb = self.dataStore[_id];
                            if (!appDb)
                                return;

                            let query;
                            if (_id !== applicationId) {
                                query = {
                                    _id: { $in: files.map((file) => file._id) }
                                };
                            } else {
                                query = {
                                    branch: { $nin: ['master', branch] },
                                    _id: { $in: files.map((file) => file._id) }
                                };
                            }

                            return appDb.findAsync(query).then((sameFiles) => {
                                if (!sameFiles.length)
                                    return;

                                const sharedFiles = files.filter((file) => {
                                    return sameFiles.find((same) => {
                                        return (same._id == file._id);
                                    });
                                });

                                // check every file if there is a newer version
                                return Promise.each(sharedFiles, (file) => {
                                    return appDb.findAsync({
                                        _id: file._id,
                                        updatedOn: { $gt: file.updatedOn }
                                    }).then((newer) => {
                                        newer.forEach((newerFile) => {
                                            newerFiles.push({
                                                applicationId: _id,
                                                file: newerFile
                                            });
                                        });
                                    });
                                });
                            });
                        });


                    });
                });

            });
        }).then(() => {
            return newerFiles;
        });


    };

    const registerDataStore = function (name) {
        return new Promise((resolve) => {
            if (self.dataStore[name]) {
                //console.log(`${name}.db is already registered`)
                return resolve(Object.keys(self.dataStore[name]).filter((k) => (k.endsWith('Async'))));
            }

            const Datastore = require('nedb');
            const coll = new Datastore({
                filename: path.join(self.settings.dataStore.path, 'projects', `${name}.db`),
                autoload: true
            });
            // add additional index
            coll.ensureIndex({ fieldName: 'branch' });

            Promise.promisifyAll(coll);
            self.dataStore[name] = coll;
            console.log(`successfully registered ${name}.db`);
            return resolve(Object.keys(self.dataStore[name]).filter((k) => (k.endsWith('Async'))));
        });
    };

    const getOperations = (table) => {
        return {
            get: (obj) => {
                if (obj === null || obj === undefined)
                    return Promise.resolve(null);
                const { _id } = (typeof obj == 'object') ? obj : { _id: obj };
                return self.dataStore[table].findOneAsync({
                    _id
                });
            },
            insert: (obj) => {
                if (!obj)
                    throw Error('Dao. insert() : No Object specified');
                return self.dataStore[table].insertAsync(obj);
            },
            /**
             * update an object
             * @param {Object} obj the object or the fields to be updated
             * @param {Boolean} merge if true, the obj must not be the whole object and gets merged with the existing one
             */
            update: (obj, merge) => {
                if (!obj)
                    throw Error('Dao. update() : No Object specified');
                const { _id } = obj;
                if (!_id)
                    throw Error('Dao. update() : No _id specified');


                return self.dataStore[table].findOneAsync({ _id }).then((existObj) => {
                    if (existObj)
                        return Promise.try(() => {
                            const keys = Object.keys(obj);
                            const isSet = ['$set', '$inc', '$push', '$pop', '$addToSet'].some((set) => keys.includes(set));
                            if (isSet)
                                return self.dataStore[table].updateAsync({ _id }, obj); // in case of isSet, pass $set etc directly to the db

                            return self.dataStore[table].updateAsync({ _id }, merge ? assign(existObj, obj) : obj); // in case of merge, merge the obj first
                        }).then(() => {
                            return self.dataStore[table].findOneAsync({ _id });
                        });

                    return self.dataStore[table].insertAsync(obj);
                });
            },
            delete: ({ _id }) => {
                if (!_id)
                    throw Error('No _id specified');
                return self.dataStore[table].removeAsync({
                    _id
                });
            },
            find: (query, ...extraQueries) => {
                if(extraQueries.length == 0)
                    return self.dataStore[table].findAsync(query);

                let find = self.dataStore[table].find(query);
                extraQueries.forEach((extraQuery) => {
                    //console.log(`calling: `, extraQuery.toString());
                    const out = extraQuery(find);
                    if(out == undefined)
                        throw Error('Extra argument must return the query object! E.g. find({ country_id: 10 }, (query) => query.sort(\'-score\').limit(1))');
                    find = out;
                });

                return new Promise((resolve, reject) => {
                    find.exec(function (err, docs) {
                        if(err)
                            reject(err);
                        resolve(docs);
                    });
                });
            },
            findOne: (query) => {
                return self.dataStore[table].findOneAsync(query);
            }
        };
    };
    const addDataSource = (tableName) => {
        collections[tableName] = getOperations(tableName);
    };

    const collections = {
        type: 'local',
        registerDataStore: (name) => {
            return registerDataStore(name).then((result) => {
                //console.log("registerDataStore [local]", result);
                collections[name] = self.dataStore[name];
                return result;
            });
        },
        detectCollision: detectCollision
    };

    Object.keys(self.dataStore).forEach((table) => {
        addDataSource(table);
    });

    return collections;

};
