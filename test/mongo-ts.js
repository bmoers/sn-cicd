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


return Promise.try(async () => {

  const a = await mongoDao.run.insert({
    mergedTs: Date.now(),
    ts: Date.now()
  });
  console.log(a._id, a.mergedTs);

  const b = await mongoDao.run.insert({
    mergedTs: Date.now(),
    ts: Date.now()
  });
  console.log(b._id, b.mergedTs);
  
})
