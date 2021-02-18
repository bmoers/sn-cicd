/* eslint-disable no-useless-call */

const Promise = require('bluebird');
const mongoose = require('mongoose');
const assign = require('object-assign-deep');

const Schema = mongoose.Schema;

const ObjectId = mongoose.ObjectId;

ObjectId.get((v) => (v ? v.toString() : v));


const schemaOptions = {
    strict: false,
    id: false,
    timestamps: true,
    minimize: false,
    toObject: {
        getters: true,
        virtuals: true,
        versionKey: false,
        flattenMaps: true
    },
    toJSON: {
        getters: true,
        virtuals: true,
        versionKey: false,
        flattenMaps: true
    }
};

const hostType = {
    "name": String
};

const dirType = {
    "code": String,
    "doc": String,
    "tmp": String,
    "web": String
};

const userType = {
    "userName": String,
    "fullName": String,
    "email": String
};


const applicationType = {
    "includeUnknownEntities": Boolean,
    "allEntitiesAsJson": Boolean,
    "id": String,
    "name": String,
    "organization": String,
    "nullForEmpty": Boolean,
    "sysFieldWhiteList": [],
    "dir": dirType,
    "docUri": String,
    "git": {
        "url": String,
        "remoteUrl": String,
        "repository": String
    }
};

const applicationSchema = new Schema(assign({
    "_id": { type: ObjectId, default: mongoose.Types.ObjectId }
}, applicationType), schemaOptions);

applicationSchema.set()

const updateSetDetailsType = {
    "sys_id": String,
    "appName": String,
    "scopeName": String,
    "scopeId": String,
    "appVersion": String,
    "name": String,
    "description": String,
    "state": String,
    "remote_sys_id": String,
    "sys_created_by": String,
    "sys_created_on": String,
    "sys_updated_by": String,
    "sys_updated_on": String
};

const updateSetSchema = new Schema({
    "_id": { type: ObjectId, default: mongoose.Types.ObjectId },
    "appId": { type: ObjectId, ref: 'application', index: true },
    "updateSetId": { type: String, index: true },
    "updateSet": updateSetDetailsType,
    "name": String,
    "running": Boolean,
    "lastBuildSequence": Number,
    "lastSuccessfulRun": String,
    "uuid": String,
    "runId": { type: ObjectId, ref: 'run', index: true },
    "pullRequestRaised": Boolean
}, schemaOptions);

const runSchema = new Schema({
    "_id": { type: ObjectId, default: mongoose.Types.ObjectId },
    "appId": { type: ObjectId, ref: 'application' },
    "usId": { type: ObjectId, ref: 'us', index: true },
    "testId": { type: ObjectId, ref: 'test' },
    "sequence": Number,
    "commitId": { type: String, index: true },
    "state": String,
    "ts": Date,
    "config": {
        "build": {
            "requestor": userType,
            "sequence": Number,
            "applicationId": String,
            "usId": { type: ObjectId, ref: 'us' },
            "runId": { type: ObjectId, ref: 'run' },
            "collisionDetection": Boolean,
            "artifact": String,
            "branchCommitId": String,
            "commitId": String
        },
        "atf": {
            "updateSetOnly": Boolean,
            "enabled": Boolean
        },
        "updateSet": updateSetDetailsType,
        "branchName": String,
        "application": applicationType,
        "mergedDeployment": Boolean,
        "forcedDeployment": Boolean,
        "git": {
            "url": String,
            "remoteUrl": String,
            "repository": String,
            "enabled": Boolean,
            "pullRequestEnabled": Boolean,
            "branchLink": String,
            "deleteBranchOnMerge": Boolean,
            "dir": String
        },
        "host": hostType,
        "master": {
            "name": String,
            "host": hostType,
            "enabled": Boolean
        },
        "deploy": {
            "host": hostType,
            "onBuildPass": Boolean,
            "onPullRequestResolve": Boolean,
            "enabled": Boolean
        }
    },
    "buildOnHost": String,
    "buildPass": Boolean,
    "buildResults": {
        "lint": Boolean,
        "doc": Boolean,
        "test": Boolean
    },
    "build": {
        "init": {
            "breakOnError": Boolean
        },
        "lint": {
            "breakOnError": Boolean,
            "enabled": Boolean,
            "files": [String],
            "config": {}
        },
        "doc": {
            "breakOnError": Boolean,
            "enabled": Boolean,
            "config": {}
        },
        "test": {
            "breakOnError": Boolean,
            "enabled": Boolean,
            "suites": [String],
            "tests": [String],
            "title": String
        },
        "artifact": String
    },
    "collision": {
        "state": String,
        "hasCollisions": Boolean,
        "collisionResolved": Boolean,
        "remoteUpdateSetID": { type: String, index: true },
        "remoteUpdateSetUrl": String,
        "issues": [{
            "type": { type: String },
            "name": String,
            "link": String
        }],
        "solution": {
            "user": userType,
            "resolutions": {}
        }
    },
    "dir": dirType,
    "updateSetState": String,
    "running": Boolean,
    "merged": Boolean,
    "mergedTs": Date,
    "branchCommitId": String
}, schemaOptions);

const stepSchema = new Schema({
    "_id": { type: ObjectId, default: mongoose.Types.ObjectId },
    "runId": { type: ObjectId, ref: 'run', index: true },
    "state": String,
    "error": {},
    "ts": Date
}, schemaOptions);

const deploymentSchema = new Schema({
    "_id": { type: ObjectId, default: mongoose.Types.ObjectId },
    "appId": { type: ObjectId, ref: 'application', index: true },
    "usId": { type: ObjectId, ref: 'us' },
    "runId": { type: ObjectId, ref: 'run' },
    "sequence": Number,
    "name": String,
    "description": String,
    "state": String,
    "commitId": { type: String, index: true },
    "sysId": String,
    "remoteUpdateSetID": { type: String, index: true },
    "scopeName": String,
    "scope": {
        "commitIds": [String],
        "artifacts": [{}],
        "updateSet": {
            "name": String,
            "scopeId": String,
            "appName": String,
            "appVersion": String,
            "description": String
        }
    },
    "baselineCommitId": String,
    "baselineTs": Date,
    "ts": Date,
    "to": String,
    "from": String,
    "start": Date,
    "end": Date,
    "mode": String,
    "type": String,
    "hasCollisions": Boolean,
    "remoteUpdateSetUrl": String,
    "issues": [{
        "type": { type: String },
        "name": String,
        "link": String
    }],
    "missingRecords": {}
}, schemaOptions);

const testSchema = new Schema({
    "_id": { type: ObjectId, default: mongoose.Types.ObjectId },
    "appId": { type: ObjectId, ref: 'application' },//String,
    "usId": { type: ObjectId, ref: 'us' },//String,
    "runId": { type: ObjectId, ref: 'run' },//String,
    "state": String,
    "commitId": { type: String, index: true },
    "ts": Date,
    "passed": Boolean,
    "onHost": String,
    "start": Date,
    "end": Date,
    "results": {
        "suiteResults": [],
        "testResults": []
    },
    "standardRun": Boolean,
    "suites": [],
    "tests": []
}, schemaOptions);

const projectSchema = new Schema({
    "_id": { type: ObjectId, default: mongoose.Types.ObjectId },
    "sysId": { type: String, index: true },
    "className": String,
    "appName": String,
    "branch": { type: {}, index: true }
}, schemaOptions);

const migrationSchema = new Schema({
    "_id": { type: ObjectId, default: mongoose.Types.ObjectId },
    "application": Number,
    "us": Number,
    "run": Number,
    "step": Number,
    "deployment": Number,
    "test": Number,
    "project": {},
    "completed": Boolean
}, schemaOptions);

const projectMetaSchema = new Schema({
    "_id": { type: ObjectId, default: mongoose.Types.ObjectId },
    "collectionName": { type: String, index: true },
    "accessCount": { type: Number, default: 0 }
}, schemaOptions);

module.exports = function () {
    const self = this;

    const jsonOptions = { getters: true, virtuals: false, versionKey: false, flattenMaps: true };

    const connection = mongoose.createConnection(process.env.CICD_DB_MONGO_URL, { useCreateIndex: true, useNewUrlParser: true, useFindAndModify: false, useUnifiedTopology: true });

    const schemaMap = {
        application: applicationSchema,
        us: updateSetSchema,
        run: runSchema,
        step: stepSchema,
        deployment: deploymentSchema,
        test: testSchema,
    }

    const projectMetaModel = connection.model('filesystem', projectMetaSchema);

    const toJson = (r) => (r ? r.toJSON(jsonOptions) : r);

    const registerDataStore = function (table) {

        const supportedOps = {
            findAsync: null,
            findOneAsync: null,
            insertAsync: 'createAsync',
            updateAsync: 'updateOneAsync', // DeprecationWarning: collection.update is deprecated
            removeAsync: null
        };

        return Promise.try(() => {
            if (!self.dataStore[table]) {

                const projectModel = connection.model(table, projectSchema, `_${table}`)

                Promise.promisifyAll(projectModel);

                // copy only the supported operations to the data store (but keep a backdoor open for the future)
                const projectModelOps = {
                    model: projectModel
                }

                Object.entries(supportedOps).forEach(([op, alias]) => {
                    //console.log('operation', op, 'alias', alias);
                    if (alias && alias in projectModel) {
                        console.log(`MONGO DAO: mapping '${op}' to internally use '${alias}'`);
                        
                        projectModelOps[op] = function () {
                            return projectModel[alias].apply(projectModel, arguments);
                        };
                    } else if (op in projectModel) {
                        if(alias){
                            console.warn(`MONGO DAO: Falling back to '${op}' as alias ${alias} is not a valid operation in ${Object.keys(projectModel)}.`);
                        }
                        projectModelOps[op] = function () {
                            return projectModel[op].apply(projectModel, arguments);
                        };
                    } else {
                        console.error(`operation ${op} not found in ${Object.keys(projectModel)}`)
                    }
                })

                self.dataStore[table] = projectModelOps;
                console.log(`successfully registered ${table} model (mongoose)`);
            }
        }).then(() => {
            return projectMetaModel.findOneAndUpdate({ collectionName: table }, { collectionName: table, $inc: { accessCount: 1 } }, { upsert: true }).exec();
        }).then(() => {

            // fix set of supported operations
            return Object.keys(supportedOps);
        })

    };

    const getOperations = (table) => {

        if (!self.dataStore[table]) {
            const schema = schemaMap[table];
            if (!schema) {
                throw Error(`Schema definition not found for table: ${table}`);
            }
            self.dataStore[table] = connection.model(table, schema, (table == 'us') ? 'update-sets' : `${table}s`);
        }

        const model = self.dataStore[table];
        Promise.promisifyAll(model);

        return {

            model,

            get: (obj) => {
                if (obj === null || obj === undefined)
                    return Promise.resolve(null);
                const { _id } = (typeof obj == 'object') ? obj : { _id: obj };
                if (!mongoose.Types.ObjectId.isValid(_id))
                    throw Error(`Dao.get() : Invalid ID: ${_id}`, obj);

                return model.findOne({ _id }).exec().then((r) => toJson(r));
            },
            insert: (obj) => {
                if (!obj)
                    throw Error('Dao.insert() : No Object specified');

                return new model(obj).save().then((r) => toJson(r));
            },
            /**
             * update an object
             * @param {Object} obj the object or the fields to be updated
             * @param {Boolean} merge if true, the obj must not be the whole object and gets merged with the existing one
             */
            update: (obj) => {
                if (!obj)
                    throw Error('Dao.update() : No Object specified');
                const { _id } = obj;
                if (!_id)
                    throw Error('Dao.update() : No _id specified');

                if (!mongoose.Types.ObjectId.isValid(_id))
                    throw Error(`Dao.update() : Invalid ID: ${_id}, ${obj}`);

                return model.findByIdAndUpdate(_id, obj, { new: true, upsert: false, lean: false }).exec().then((r) => toJson(r));
            },
            delete: ({ _id }) => {
                if (!_id)
                    throw Error('Dao.delete() : No _id specified');
                if (!mongoose.Types.ObjectId.isValid(_id))
                    throw Error(`Dao.delete() : Invalid ID: ${_id}`);

                return model.deleteOne({
                    _id
                }).exec();
            },
            find: (query, ...extraQueries) => {
                let find = model.find(query);
                extraQueries.forEach((extraQuery) => {
                    //console.log(`calling: `, extraQuery.toString());
                    const out = extraQuery(find);
                    if(out == undefined)
                        throw Error(`Extra argument must return the query object! E.g. find({ country_id: 10 }, (query) => query.sort('-score').limit(1))`); //https://mongoosejs.com/docs/api.html#query-js
                    find = out;
                })
                return find.exec().then((l) => l.map((r) => toJson(r)));
            },
            findOne: (query) => {
                return model.findOne(query).exec().then((r) => toJson(r));
            }
        };
    };
    
    const collections = {
        type: 'mongo',
        registerDataStore: (name) => {
            return registerDataStore(name).then((operations) => {
                collections[name] = self.dataStore[name];
                return operations;
            });
        },
        detectCollision: () => { },
        __migration: Promise.promisifyAll(connection.model('__migration', migrationSchema, '__migration'))
    };

    const addDataSource = (tableName) => {
        collections[tableName] = getOperations(tableName);
    }

    Object.keys(self.dataStore).forEach((table) => {
        addDataSource(table);
    });

    return collections;

};
