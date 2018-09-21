require('dotenv').config();

var Promise = require('bluebird');

const fs = require('fs');
const io = require('socket.io-client');
const os = require("os");
const path = require("path");

const logger = new console.Console(process.stdout, process.stderr);
require('console-stamp')(logger, {
    pattern: 'HH:MM:ss.l',
    metadata: `[${process.pid}]`.padEnd(8),
    colors: {
        stamp: ['blue'],
        label: ['white'],
        metadata: ['green']
    }
});

// custom serialization for error object
if (!('toJSON' in Error.prototype)) {
    Object.defineProperty(Error.prototype, 'toJSON', {
        value: function () {
            var alt = {};

            Object.getOwnPropertyNames(this).forEach(function (key) {
                alt[key] = this[key];
            }, this);

            return alt;
        },
        configurable: true,
        writable: true
    });
}

//path.join(process.cwd(), 'db')
const certDir = path.join(__dirname, '../', '../', 'cert');

const ebHost = process.env.CICD_EB_HOST_NAME || 'localhost';
const ebPort = process.env.CICD_EB_HOST_PORT || 4443;
const ebClientKey = process.env.CICD_EB_HOST_CLIENT_KEY || path.resolve(certDir, 'eb-client-key.pem');
const ebClientCert = process.env.CICD_EB_HOST_CLIENT_CERT || path.resolve(certDir, 'eb-client-crt.pem');
const ebClientCa = (process.env.CICD_EB_HOST_CLIENT_CA !== undefined) ? process.env.CICD_EB_HOST_CLIENT_CA : path.resolve(certDir, 'eb-ca-crt.pem');



module.exports = function () {
    const self = this;
    
    logger.log('Event Bus Worker Created');

    var socket = io(`https://${ebHost}:${ebPort}/worker`, {
        key: fs.readFileSync(ebClientKey),
        cert: fs.readFileSync(ebClientCert),
        ca: (ebClientCa) ? fs.readFileSync(ebClientCa) : null
    }).binary(false);

    let clientState = 'pause';
    const host = os.hostname();
    const platform = os.platform();

    var run = () => {
        //logger.log("Event Bus Worker Executed [run()]");
        
        return new Promise((resolve) => {
            socket.emit('get', {
                id: socket.id,
                host: host,
                platform: platform
            }, resolve);
        }).then((job) => {
            if (!job) {
                // pause this worker if there are no more jobs to be processed.
                clientState = 'pause';
                // let the server know
                socket.emit('paused');
                return;
            }

            logger.log(`Starting module: ${job.name}`);

            return Promise.try(() => {
                if (job.name in self.modules)
                    return self.modules[job.name];
                
                throw new Error(`Module ${job.name} not found.`);
                
            }).then((dynamicModule) => {
                if (job.async) {
                    return new Promise((resolve) => {
                        job.result = 'ASYNC';

                        console.log(`STARTING ASYNC JOB '${job.name}'`);
                        dynamicModule.call(self, job.options).then((result) => {
                            console.log(`ASYNC JOB '${job.name}' completed with: ${result}`)
                        }).catch((e) => {
                            console.error(`ASYNC JOB ERROR: Job '${job.name}'`, job, e);
                        });
                        resolve();
                    });
                } else {
                    return dynamicModule.call(self, job.options).then((result) => {
                        job.result = result;
                    });
                }
                
            }).catch((e) => {
                job.error = e;
                console.error(`PROMISE JOB ERROR: Job '${job.name}'`, job, e);
            }).then(() => {
                //console.log("send work done");
                return new Promise((resolve) => {
                    socket.emit('done', {
                        id: job.id,
                        result: job.result,
                        error: job.error,
                        async :job.async,
                        host: host,
                        platform: platform
                    }, resolve);
                });
            }).then(() => {
                return run();
            });

        });
        
    };

    socket.on('connect', () => {

        logger.log('Worker connected');

        require('console-stamp')(logger, {
            pattern: 'HH:MM:ss.l',
            metadata: `[${process.pid}]`.padEnd(8).concat(` [${socket.id}]`),
            colors: {
                stamp: ['yellow'],
                label: ['white'],
                metadata: ['magenta']
            }
        });
        
        // socket.connected  
        //logger.log('connect');

        clientState = 'pause';

        socket.emit('register', {
            id: socket.id,
            host: host,
            platform: platform
        });

    });

    socket.on('run', () => {
        if (clientState !== 'run') {
            //logger.log('ON run');
            clientState = 'run';
            socket.emit('running', {}, run);
        }
    });
    return {
        stop: () => {
            socket.disconnect();
        }
    }
};