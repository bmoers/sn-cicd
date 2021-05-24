
process.env.TESTING = true;
process.env.CICD_EB_WORKER_CLUSTER_NUM = 0;

const Promise = require('bluebird');

const CICD = require('../lib/cicd');
const ExeJob = require('../lib/eb/job');
const QueueJob = require('../lib/eb/queue-job');

CICD.prototype.jobs = async function () {


    const list = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(e => {
        return new QueueJob({ name: 'dummy', description: 'number: ' + e, background: true, exclusiveId: 1 }, { body: 'body ' + e });
    });


    const list2 = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(e => {
        return new QueueJob({ name: 'dummy', description: 'exclusive 2: ' + e, background: true, exclusiveId: 2 }, { body: 'body ' + e });
    });

    console.log('------------------------ wait for all');
    const res = await Promise.all(list.concat(list2));

    console.log('------------------------ done');
    console.log(res.map(r => r.result));
    console.log(res);

    /*
    // this job is executed via 'exe' and pushed to the workers
    const result = await new ExeJob({ name: 'dummy', background: false }, { body: 'body' });
    console.log('result----------------------------------------->', result);
    */
};

CICD.prototype.job = async function () {



    const result = await new ExeJob({ name: 'dummy', background: true, description: 'dummy job', exclusiveId: 2 }, { body: 'body ' });

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
        c.self.job();
        await c.self.job();
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


