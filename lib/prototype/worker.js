const cluster = require('cluster');
const numCPUs = (process.env.CICD_EB_WORKER_CLUSTER_NUM !== undefined && process.env.CICD_EB_WORKER_CLUSTER_NUM !== null && process.env.CICD_EB_WORKER_CLUSTER_NUM.length > 0 && !isNaN(process.env.CICD_EB_WORKER_CLUSTER_NUM)) ? parseInt(process.env.CICD_EB_WORKER_CLUSTER_NUM, 10) : require('os').cpus().length;

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
    

    return self.init(self.WORKER).then(() => {
        if (cluster.isMaster && numCPUs > 0) {

            cluster.on('online', function (worker) {
                console.log('Worker ' + worker.process.pid + ' is online.');
            });
            cluster.on('exit', function (worker, code, signal) {
                console.error('worker ' + worker.process.pid + ' died.');
                cluster.fork();
            });

            console.log(`Master Worker Process ${process.pid} is running. Starting ${numCPUs} clients.`);
            for (let i = 0; i < numCPUs; i++) {
                console.log(`Forking process number ${i}...`);
                cluster.fork();
            }
        } else {
            if (numCPUs === 0) {
                console.log('Running in Standalone Mode.');
                console.log('Starting Worker process.');
            }
            require('../eb/worker').call(self);
        } 
    });

};