module.exports = function () {
    const self = this;

    const cluster = require('cluster');
    const numCPUs = (process.env.CICD_EB_WORKER_CLUSTER_NUM !== undefined && process.env.CICD_EB_WORKER_CLUSTER_NUM !== null && process.env.CICD_EB_WORKER_CLUSTER_NUM.length > 0 && !isNaN(process.env.CICD_EB_WORKER_CLUSTER_NUM)) ? parseInt(process.env.CICD_EB_WORKER_CLUSTER_NUM, 10) : require('os').cpus().length;

    if (numCPUs === 0) {
        console.log('Running in Standalone Mode, make sure a Worker Process is running!');
        console.log('Starting Server process.');
        return self.server();
    }

    console.log('Running in Embedded Cluster Mode');

    if (cluster.isMaster) {

        cluster.on('online', function (worker) {
            console.log('Worker ' + worker.process.pid + ' is online.');
        });
        cluster.on('exit', function (worker, code, signal) {
            console.error('worker ' + worker.process.pid + ' exited.', code, signal);
            cluster.fork();
        });


        cluster.on('disconnect', function ({ id, process }) {
            console.log('worker ' + id + ' disconnected', process.pid, process.exitCode, process.signalCode);
        });
        cluster.on('error', function (worker, code, signal) {
            console.log('worker ' + worker.id + ' errored', code, signal);
        });
        cluster.on('error', function (worker, code, signal) {
            console.log('worker ' + worker.pid + ' errored', code, signal);
        });

        console.log('Starting Server process.');
        return self.server().then(() => {
            console.log(`Master ${process.pid} is running. Starting ${numCPUs} clients.`);
            for (let i = 0; i < numCPUs; i++) {
                console.log(`Forking process number ${i}...`);
                cluster.fork();
            }
        });
    } else {
        return self.worker();
    }
};
