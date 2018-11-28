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
        ca: (ebClientCa) ? fs.readFileSync(ebClientCa) : null,
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 8000,
        reconnectionAttempts: Infinity,
        timeout: 20000
    }).binary(false);

    let clientState = 'pause';
    const host = os.hostname();
    const platform = os.platform();

    const getRandomInt = (min, max) => {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    var run = () => {
        if (clientState == 'run')
            return;
        
        clientState = 'run';
        
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
                        // when job done, reset the worker clientState to pause
                        clientState = 'pause';
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
        });
    };

    /*
        this is a fix for the worker not to connect if 
        the server was down on worker start.

        https://github.com/socketio/socket.io-client/issues/1179
    */
    setTimeout(() => {
        if (socket.disconnected) {
            logger.info("Connection is down, force reconnecting.");

            socket.io.reconnecting = false;
            socket.io.onclose();
        }
    }, 2000);

    socket.on('reconnect_error', (e) => {
        logger.log(`(Re) Connecting to CICD Server failed. Check if 'https://${ebHost}:${ebPort}' can be reached.`, e.message, e.type)
    });
    socket.on('reconnect_attempt', (attemptNumber) => {
        logger.log("(Re) Connecting Attempt", attemptNumber);
    });
    socket.on('disconnect', (reason) => {
        if (reason === 'io server disconnect') {
            // the disconnection was initiated by the server, you need to reconnect manually
            logger.log("io server disconnected, reconnect now");
            socket.connect();
        }
        // else the socket will automatically try to reconnect
    });


    socket.on('connect', () => {

        logger.log('Worker connected');

        // update logger with socket.id
        require('console-stamp')(logger, {
            pattern: 'HH:MM:ss.l',
            metadata: `[${process.pid}]`.padEnd(8).concat(` [${socket.id}]`),
            colors: {
                stamp: ['yellow'],
                label: ['white'],
                metadata: ['magenta']
            }
        });
        
        clientState = 'pause';

        socket.emit('register', {
            id: socket.id,
            host: host,
            platform: platform,
            statistics: getStatistics()
        }, (env) => {
            logger.log(`Worker: copy environment variables from server #${Object.keys(env).length}`)
            Object.keys(env).forEach((key) => {
                process.env[key] = env[key];
            });
        });

        // random interval for statistics
        const statistics = () => {
            socket.emit('statistics', {
                id: socket.id,
                statistics: getStatistics()
            }, () => {
                setTimeout(statistics, getRandomInt(15000, 30000));    
            });
        }
        setTimeout(statistics, getRandomInt(15000, 30000));

        // in case the job was not successfully sent from the server, let the worker pull.
        const pull = () => {
            if (clientState !== 'run') {
                socket.emit('running', {}, run);
            }
            setTimeout(pull, getRandomInt(60000, 120000));
        }
        setTimeout(pull, getRandomInt(60000, 120000));

        self.emit('worker-started', socket.id);
    });

    socket.on('run', () => {
        if (clientState !== 'run') {
            socket.emit('running', {}, run);
        }
    });
   
    socket.on('housekeeping', ({ codeDir }) => {
        if (codeDir) {
            if (!fs.existsSync(codeDir))
                return;// logger.error("Path does not exist", codeDir);
            
            logger.info(`***************************`);
            logger.info(`CLEANUP: deleting directory ${codeDir}`);
            logger.info(`***************************`);
            
            try {
                return fs.removeSync(codeDir);
            } catch(e) {
                // as there is no callback for broadcast messages, display error
                logger.error("Cleanup failed", e);
            }
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
    });

    return {
        stop: () => {
            socket.disconnect();
        }
    }
};