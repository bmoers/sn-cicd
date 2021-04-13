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
        mergedTs: new Date(),
        ts: new Date()
    });

    const b = await mongoDao.run.insert({
        mergedTs: Date.now(),
        ts: Date.now()
    });

    const doc = await mongoDao.run.find({ mergedTs: { $not: { $type: 9 } }, _id: { $in: [a._id, b._id] } });

    console.log('invalid date records:', doc.length);


    const allDoc = await mongoDao.run.find({ mergedTs: { $not: { $type: 9 } } });
    console.log('all invalid records:', allDoc.length);

    await mongoDao.run.find({ mergedTs: { $not: { $type: 9 } } }).then((result) => {
        return Promise.each(result, (run) => {
            run.mergedTs = new Date(run.mergedTs);
            return mongoDao.run.update(run);
        });
    });

    const allDocClean = await mongoDao.run.find({ mergedTs: { $not: { $type: 9 } } });

    console.log(allDocClean.length);

});
