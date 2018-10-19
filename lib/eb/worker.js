require('dotenv').config();

const Promise = require('bluebird');
const fs = Promise.promisifyAll(require("fs-extra"));
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

const runModule = require('./run-module');

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

const certDir = path.join(__dirname, '../', '../', 'cert');

const ebHost = process.env.CICD_EB_HOST_NAME || 'localhost';
const ebPort = process.env.CICD_EB_HOST_PORT || 4443;
const ebClientKey = process.env.CICD_EB_HOST_CLIENT_KEY || path.resolve(certDir, 'eb-client-key.pem');
const ebClientCert = process.env.CICD_EB_HOST_CLIENT_CERT || path.resolve(certDir, 'eb-client-crt.pem');
const ebClientCa = (process.env.CICD_EB_HOST_CLIENT_CA !== undefined) ? process.env.CICD_EB_HOST_CLIENT_CA : path.resolve(certDir, 'eb-ca-crt.pem');

const getStatistics = () => {

    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    return {
        mem: mem,
        cpu: cpu,
        num: Number.parseInt((mem.heapUsed / 1024 / 1024) * (cpu.user / 1000), 10).toFixed(0)
    };
}

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
                socket.emit('paused', {
                    statistics: getStatistics()
                });
                return;
            }
            return runModule.call(self, job, job.options, logger,
                (job) => {
                    return new Promise((resolve) => {
                        socket.emit('done', {
                            id: job.id,
                            result: job.result,
                            error: job.error,
                            background: job.background,
                            host: host,
                            platform: platform,
                            type: job.type
                        }, resolve);
                    }).then(() => {
                        return run();
                    });
                },
                (job) => {
                    return new Promise((resolve) => {
                        socket.emit('background-in-progress', {
                            id: job.id,
                            result: 'BACKGROUND-JOB-IN-PROGRESS',
                            error: job.error,
                            background: job.background,
                            host: host,
                            platform: platform,
                            type: job.type
                        }, resolve);
                    });
                }
            );

            /*
            return runModule.call(self, job, job.options, logger).catch((e) => {
                job.error = e;
                logger.error(`JOB ERROR: Job '${job.name}'`, job, e);
            }).then((result) => {
                //logger.log("send work done");
                return new Promise((resolve) => {
                    socket.emit('done', {
                        id: job.id,
                        result: result,
                        error: job.error,
                        background: job.background,
                        host: host,
                        platform: platform
                    }, resolve);
                });
            }).then(() => {
                return run();
            });
            */            
            /*
            logger.log(`Starting module: ${job.name}`);

            return Promise.try(() => {
                if (job.name in self.modules)
                    return self.modules[job.name];
                
                throw new Error(`Module ${job.name} not found.`);
                
            }).then((dynamicModule) => {
                if (job.background) {

                    return new Promise((resolve) => {
                        logger.log(`STARTING BACKGROUND JOB '${job.name}'`);
                        dynamicModule.call(self, job.options, logger).then((result) => {
                            job.result = result;
                            //logger.log(`BACKGROUND JOB '${job.name}' completed with: ${result}`);
                        }).catch((e) => {
                            job.error = e;
                            logger.error(`BACKGROUND JOB ERROR: Job '${job.name}'`, job, e);
                        }).then(() => {
                            //logger.log("send work done");
                            return new Promise((resolve) => {
                                socket.emit('done', {
                                    id: job.id,
                                    result: job.result,
                                    error: job.error,
                                    background: job.background,
                                    host: host,
                                    platform: platform
                                }, resolve);
                            });
                        }).then(() => {
                            // only run the next job once this is done!
                            return run();
                        });
                        resolve();
                    }).catch((e) => {
                        job.error = e;
                        logger.error(`BACKGROUND JOB Setup ERROR: Job '${job.name}'`, job, e);
                    }).then(() => {
                        // emit progress so events get resolved
                        return new Promise((resolve) => {
                            socket.emit('background-in-progress', {
                                id: job.id,
                                result: 'BACKGROUND-JOB-IN-PROGRESS',
                                error: job.error,
                                background: job.background,
                                host: host,
                                platform: platform
                            }, resolve);
                        });
                    });
                    
                } else {

                    logger.log(`STARTING PROMISE JOB '${job.name}'`);
                    return dynamicModule.call(self, job.options, logger).then((result) => {
                        job.result = result;
                    }).catch((e) => {
                        job.error = e;
                        logger.error(`PROMISE JOB ERROR: Job '${job.name}'`, job, e);
                    }).then(() => {
                        //logger.log("send work done");
                        return new Promise((resolve) => {
                            socket.emit('done', {
                                id: job.id,
                                result: job.result,
                                error: job.error,
                                background: job.background,
                                host: host,
                                platform: platform
                            }, resolve);
                        });
                    }).then(() => {
                        return run();
                    });
                }
                
            });
            */
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
            platform: platform,
            statistics: getStatistics()
        }, (env) => {
            console.log(`Worker: copy environment variables from server #${Object.keys(env).length}`)
            Object.keys(env).forEach((key) => {
                process.env[key] = env[key];
            })
        });

        setInterval(() => {
            socket.emit('statistics', {
                id: socket.id,
                statistics: getStatistics()
            });
        }, 5000);

        // in case the job was not successfully sent from the server, let the worker pull.
        setInterval(() => {
            if (clientState !== 'run') 
                run()
        }, 15000);

        self.emit('worker-started', socket.id);
    });

    socket.on('run', () => {
        if (clientState !== 'run') {
            //logger.log('ON run');
            clientState = 'run';
            socket.emit('running', {}, run);
        }
    });
   
    socket.on('housekeeping', ({ codeDir }) => {
        if (codeDir) {
            logger.warn(`\n***************************\nCLEANUP: deleting direcotry ${codeDir}\n***************************`);
            if (!fs.existsSync(codeDir))
                logger.error("Path does not exist!", codeDir);
            
            return fs.removeSync(codeDir);
        }
    });

    socket.on('exe', (job) => {
        
        job.result = undefined; job.error = undefined;

        return runModule.call(self, job, job.options, logger,
            (job) => {
                return new Promise((resolve) => {
                    socket.emit('done', {
                        id: job.id,
                        result: job.result,
                        error: job.error,
                        background: job.background,
                        host: host,
                        platform: platform,
                        type: job.type
                    }, resolve);
                });
            },
            (job) => {
                return new Promise((resolve) => {
                    socket.emit('background-in-progress', {
                        id: job.id,
                        result: 'BACKGROUND-JOB-IN-PROGRESS',
                        error: job.error,
                        background: job.background,
                        host: host,
                        platform: platform,
                        type: job.type
                    }, resolve);
                });
            }
        );
        /*
        return runModule.call(self, job, job.options, logger).then((result) => {
            job.result = result;
        }).catch((e) => {
            job.error = e;
            logger.error(`EXE JOB ERROR: Job '${job.name}'`, job, e);
        }).finally(() => {

            socket.emit('exe_results', {
                id: job.id,
                result: job.result,
                error: job.error,
                background: job.background,
                host: host,
                platform: platform
            });
        });
        */
    });

    return {
        stop: () => {
            socket.disconnect();
        }
    }
};