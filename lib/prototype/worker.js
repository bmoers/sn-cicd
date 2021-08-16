const cluster = require('cluster');
const chalk = require('chalk');
const numCPUs = (()=> {
    const num = parseInt(process.env.CICD_EB_WORKER_CLUSTER_NUM, 10);
    return isNaN(num) ? require('os').cpus().length : num;
})();

const figlet = require('figlet');

/**
 * Implements CICD.worker()
 *
 * @param {*} num Numbers of workers to start, default to num of system cpus
 */
module.exports = async function (forked) {
    const self = this;

    if (cluster.isMaster && numCPUs > 0) {
        
        const beacons = {};

        cluster.on('online', function (node) {
            console.log(`Worker ${node.process.pid} is online.`);
            beacons[node.process.pid] = self.createBeacon();
        });
        cluster.on('exit', function (node) {
            beacons[node.process.pid].die();
            if (self.isServerShuttingDown()) {
                console.log(`Worker ${node.process.pid} gracefully stopped`);
            } else {
                console.log(`Worker ${node.process.pid} died`);
                cluster.fork();
            }
        });


        self.setupLightship(false);

        console.log(`Master Worker Process ${process.pid} is running. Starting ${numCPUs} clients.`);
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
        
        self.emit('lightship-ready');

        return;
    }

    console.log('Starting Worker process.');

    console.log(`${'- '.repeat(70)}\n${chalk.cyan(figlet.textSync(`WORKER ${process.pid}`, { font: 'Larry 3D', horizontalLayout: 'full', verticalLayout: 'default' }))
    }\n${'- '.repeat(70)}`);

    if (forked) {
        console.log(' ************ Running as a forked process of the Server. ************ ');
    }

    await self.init(self.WORKER);

    if (numCPUs === 0) {
        console.log('Running in Standalone Mode.');
    }

    self.setupLightship(forked);

    const worker = require('../eb/worker').call(self);

    self.once('worker-started', () => {
        self.registerShutdownHandler(`Worker ${process.pid}`, () => {
            worker.stop();
        });
        self.emit('lightship-ready');
    });

    process.on('message', function (msg) {
        if (msg.type == 'shutdown') {
            console.log(`Worker ${process.pid} shutting down`);
            self.emit('lightship-shutdown');
        }
    });

};
