require('dotenv').config();

delete process.env.CICD_DB_MONGO_URL;

const Promise = require('bluebird');
const path = require('path');

const dataStore = {
    application: null,
    us: null,
    run: null,
    step: null,
    deployment: null,
    test: null
};

const Datastore = require('nedb');
Object.keys(dataStore).forEach((collection) => {
    console.log(path.join('db', `${collection}.db`));
    const coll = new Datastore({
        filename: path.join('db', `${collection}.db`),
        autoload: true
    });
    Promise.promisifyAll(coll);
    dataStore[collection] = coll;
});

const nedbDao = require('../lib/prototype/dao').call({
    dataStore
});


return Promise.try(async () => {

    const a = await nedbDao.run.insert({
        mergedTs: new Date(),
        ts: new Date()
    });
  
    const b = await nedbDao.run.insert({
        mergedTs: Date.now(),
        ts: Date.now()
    });

    const doc =      await nedbDao.run.find({mergedTs: {$ne: {$type: 9}}, _id : {$in : [a._id, b._id]}});
  
    console.log(doc.length);
  

    const allDoc =      await nedbDao.run.find({mergedTs: {$ne: {$type: 9}}});
  
    console.log(allDoc.length);
  
});
