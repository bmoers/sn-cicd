
process.env.TESTING = true;
process.env.CICD_EB_WORKER_CLUSTER_NUM = 0;

const Promise = require('bluebird');

const CICD = require('../lib/cicd');
const EventBusJob = require('../lib/eb/job');
const EbQueueJob = require('../lib/eb/queue-job');

CICD.prototype.jobs = async function(){
    

    const list = [1,2,3,4,5,6,7,8,9].map(e => {
        return new EventBusJob({ name: 'dummy', background: false }, { body: 'body ' + e });
    });

    console.log('------------------------ wait for all');
    const res = await Promise.all(list);

    console.log('------------------------ done');
    console.log(res.map(r => r.result));
    console.log(res);

    /*
    // this job is executed via 'exe' and pushed to the workers
    const result = await new EventBusJob({ name: 'dummy', background: false }, { body: 'body' });
    console.log('result----------------------------------------->', result);
    */
};

(async ()  =>{

    const c = new CICD();
    c.start();
    await Promise.delay(1000);

    c.worker();
    
    await Promise.delay(1000);
    console.log('test jobs');
    await c.self.jobs();
})();


