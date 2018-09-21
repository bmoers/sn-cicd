require('dotenv').config();


const cluster = require('cluster');
const numCPUs = (process.env.CICD_EB_WORKER_CLUSTER_NUM && process.env.CICD_EB_WORKER_CLUSTER_NUM > 0) ? process.env.CICD_EB_WORKER_CLUSTER_NUM : require('os').cpus().length;

const figlet = require('figlet');

/**
 * Implements CICD.worker()
 *
 * @param {*} num Numbers of workers to start, default to num of system cpus
 */
module.exports = function () {
    const self = this;

    console.log('\n' + '- '.repeat(70) + '\n' + figlet.textSync(`WORKER ${process.pid}`, {
        font: 'Larry 3D',
        horizontalLayout: 'full',
        verticalLayout: 'default'
    }) + '\n' + '- '.repeat(70));

    self.init(self.WORKER);

    //self.eventBusWorker.push(require('../eb/worker').call(self));
    
    if (cluster.isMaster) {
        console.log(`Master ${process.pid} is running. Starting ${numCPUs} clients.`);

        for (let i = 0; i < numCPUs; i++) {
            console.log(`Forking process number ${i}...`);
            cluster.fork();
        }
    } else {
        //cicd.eventBusWorker.push(Worker.call(this));
        require('../eb/worker').call(self);
    }
    
};