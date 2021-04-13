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

    return mongoDao.run.find({
        usId: '5e9834026e56ea5f40334be7'
    });
}).then((runList) => {
    var maxRun = 2;
    var sortedRun = runList.sort((a, b) => {
        return b.ts - a.ts;
    });
    var length = -1 * (sortedRun.length - maxRun);
    console.log(length);
    length = -1 * (sortedRun.length - maxRun);

    console.log(sortedRun.map((r) => r.sequence));

    if (length < 0) {
        console.log(`\tto be deleted # ${length * -1}`);
        var removeRun = sortedRun.slice(length);
        console.log(removeRun.map((r) => r.sequence));
    }
});
