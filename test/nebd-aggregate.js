require('dotenv').config();

delete process.env.CICD_DB_MONGO_URL

const Promise = require('bluebird');
const path = require('path');

const dataStore = {
  application: null,
  us: null,
  run: null,
  step: null,
  deployment: null,
  test: null
}

const Datastore = require('nedb');
Object.keys(dataStore).forEach((collection) => {
    console.log(path.join('db', `${collection}.db`))
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


return Promise.try(() => {

  return nedbDao.deployment.find({}, (query) => {
    return query.sort({ ts: -1 });
  },
    (query) => {
    return query.limit(1);
    });
}).then((runList) => {
  console.log(runList);
})
