
process.env.TESTING = true;
process.env.CICD_EB_WORKER_CLUSTER_NUM = 0;

const Promise = require('bluebird');

const CICD = require('../lib/cicd');
const ExeJob = require('../lib/eb/job');
const QueueJob = require('../lib/eb/queue-job');

CICD.prototype.exeJobs = async function (num, background) {


    const list1 = Promise.map(Array(num).fill(0), ((e, index) => {
        return new ExeJob({ name: 'dummy', description: 'number: ' + e, background, exclusiveId: 1 }, { body: 'body ' + e, index });
    }));

    // mapSeries
    const list2 = Promise.map(Array(num).fill(0), ((e, index) => {
        return new ExeJob({ name: 'dummy', description: 'exclusive 2: ' + e, background, exclusiveId: 2 }, { body: 'body ' + e, index });
    }));

    console.log('------------------------ wait for all');

    const out = await Promise.all([list1, list2]);
    const res = [...out[0], ...out[1]];

    console.log('------------------------ done');
    if (background) {
        console.log('job ids');
        console.log(res.map(r => r._id));
    } else {
        console.log('job results');
        console.log(res.map(r => r.result));
    }

};
CICD.prototype.queueJobs = async function (num, background) {


    const list1 = Promise.map(Array(num).fill(0), ((e, index) => {
        return new QueueJob({ name: 'dummy', description: 'number: ' + e, background, _exclusiveId: 3 }, { body: 'body ' + e, index });
    }));

    // mapSeries
    const list2 = Promise.map(Array(num).fill(0), ((e, index) => {
        return new QueueJob({ name: 'dummy', description: 'exclusive 2: ' + e, background, _exclusiveId: 4 }, { body: 'body ' + e, index });
    }));

    console.log('------------------------ wait for all');

    const out = await Promise.all([list1, list2]);
    const res = [...out[0], ...out[1]];

    console.log('------------------------ done');
    if (background) {
        console.log('job ids');
        console.log(res.map(r => r._id));
    } else {
        console.log('job results');
        console.log(res.map(r => r.result));
    }
};

CICD.prototype.job = async function () {



    const result = await new ExeJob({ name: 'dummy', background: true, description: 'dummy job', exclusiveId: 5 }, { body: 'body ', index: 0 });

    // console.log('------------------------ done');
    // console.log(result);

    /*
    // this job is executed via 'exe' and pushed to the workers
    const result = await new ExeJob({ name: 'dummy', background: false }, { body: 'body' });
    */
    console.log('result----------------------------------------->', result);
    return result;
};

(async () => {

    try {
        const c = new CICD();
        c.self.init(c.self.WORKER);

        console.log('test jobs');

        await c.self.exeJobs(10,true);
        await c.self.queueJobs(1,false);
        /*
         const job = await c.self.job();
         console.log(job);
    
        await Promise.delay(5 * 1000);

        const jobDetails = await c.self.db.job_queue.find({ _id: job._id });
        console.log(jobDetails);
        */
    } catch (e) {
        console.error('job failed', e);
    }
})();


