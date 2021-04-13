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

    const a = await mongoDao.deployment.find({},
        (query) => {
            return query.sort({ ts: -1 });
        },
        (query) => {
            return query.limit(1);
        });

    const b = await mongoDao.deployment.find({},
        (query) => {
            return query.sort({ ts: -1 }).limit(1);
        });

    console.log(a.length == b.length);
    console.log(a[0]._id == b[0]._id);

});
