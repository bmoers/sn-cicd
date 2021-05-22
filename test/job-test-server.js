
process.env.TESTING = true;
process.env.CICD_EB_WORKER_CLUSTER_NUM = 0;

const Promise = require('bluebird');

const CICD = require('../lib/cicd');
const EventBusJob = require('../lib/eb/job');
const EbQueueJob = require('../lib/eb/queue-job');


(async ()  =>{

    const c = new CICD();
    c.start();
    c.worker();
    c.worker();

})();


