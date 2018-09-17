require('dotenv').config();


const cluster = require('cluster');
const numCPUs = (process.env.CICD_EB_WORKER_CLUSTER_NUM && process.env.CICD_EB_WORKER_CLUSTER_NUM > 0) ? process.env.CICD_EB_WORKER_CLUSTER_NUM : require('os').cpus().length;


/**
 * Implements CICD.worker()
 *
 * @param {*} num Numbers of workers to start, default to num of system cpus
 */
module.exports = function (num) {
    const self = this;
    self.eventBusWorker = [];

    self.init(self.WORKER);

    const forkNum = num || numCPUs;
    //self.eventBusWorker.push(require('../eb/worker').call(self));
    
    if (cluster.isMaster && forkNum > 1) {
        console.log(`Master ${process.pid} is running. Starting ${forkNum} clients.`);

        for (let i = 0; i < forkNum; i++) {
            console.log(`Forking process number ${i}...`);
            cluster.fork();
        }
    } else {
        //cicd.eventBusWorker.push(Worker.call(this));
        self.eventBusWorker.push(require('../eb/worker').call(self));
    }
    
};