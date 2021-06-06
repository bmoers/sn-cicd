
process.env.TESTING = true;
process.env.CICD_EB_WORKER_CLUSTER_NUM = 0;

const Promise = require('bluebird');

const CICD = require('../lib/cicd');

(async ()  =>{

    const c = new CICD();

    
    c.worker();
    
})();


