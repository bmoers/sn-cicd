module.exports = function () {
    const self = this;

    const cluster = require('cluster');
    const numCPUs = (process.env.CICD_EB_WORKER_CLUSTER_NUM && process.env.CICD_EB_WORKER_CLUSTER_NUM > 0) ? process.env.CICD_EB_WORKER_CLUSTER_NUM : require('os').cpus().length;

    if (cluster.isMaster) {

        console.log('Starting Server process.');
        self.server();

        console.log(`Master ${process.pid} is running. Starting ${numCPUs} clients.`);
        for (let i = 0; i < numCPUs; i++) {
            console.log(`Forking process number ${i}...`);
            cluster.fork();
        }
    } else {
        self.worker();
    }
};