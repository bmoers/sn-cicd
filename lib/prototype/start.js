const Promise = require('bluebird');

module.exports = async function () {
    const self = this;

    const cluster = require('cluster');
    const numCPUs = (() => {
        const num = parseInt(process.env.CICD_EB_WORKER_CLUSTER_NUM, 10);
        return isNaN(num) ? require('os').cpus().length : num;
    })();


    if (cluster.isMaster) {

        if (numCPUs == 0) {
            console.log('Running in Standalone Mode, make sure a Worker Process is running!');

        }

        console.log('Starting Server process.');
        await self.server();

        if (numCPUs > 0) {

            console.log('Running in Embedded Cluster Mode');
            const beacons = {};
            cluster.on('online', function (node) {
                console.log(`Worker ${node.process.pid} is online.`);
                beacons[node.process.pid] = self.createBeacon();
            });
            cluster.on('exit', function (node) {
                beacons[node.process.pid].die();
                if(self.isServerShuttingDown()) {
                    console.log(`Worker ${node.process.pid} gracefully stopped`);
                } else {
                    console.log(`Worker ${node.process.pid} died`);
                    cluster.fork();
                }
            });
            cluster.on('disconnect', function ({ id, process }) {
                console.log(`Worker ${process.pid} (${id}) disconnected`);
            });

            console.log(`Master ${process.pid} is running. Starting ${numCPUs} clients.`);

            for (let i = 1; i <= numCPUs; i++) {
                console.log(`Forking process number ${i}...`);
                const node = cluster.fork();
                for (const signal of self.shutdownSignals) {
                    process.on(signal, () => {
                        console.log(`Send shutdown message to worker ${node.process.pid} (${i})`);
                        node.send({ type: 'shutdown' });
                    });
                }
            }
        }
        return;
    }

    return self.worker(true);

};
