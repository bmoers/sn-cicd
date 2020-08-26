require('dotenv').config();

const Promise = require('bluebird');


const mongoDao = require('../lib/prototype/mongo-dao').call({
  dataStore: {
    application: null,
    us: null,
    run: null,
    step: null,
    deployment: null,
    test: null
  }
});

return Promise.try(() => {

  return mongoDao.deployment.find({}, (query) => {
    return query.sort({ ts: -1 });
  },
    (query) => {
    return query.limit(1);
    });
}).then((runList) => {
  console.log(runList);
})
