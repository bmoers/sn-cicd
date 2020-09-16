const fs = require('fs');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const path = require("path");

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

const ebPort = process.env.CICD_EB_HOST_PORT || 4443;
const ebServerKey = process.env.CICD_EB_HOST_SERVER_KEY || path.resolve(certDir, 'eb-server-key.pem');
const ebServerCert = process.env.CICD_EB_HOST_SERVER_CERT || path.resolve(certDir, 'eb-server-crt.pem');
const ebServerCa = (process.env.CICD_EB_HOST_SERVER_CA !== undefined) ? process.env.CICD_EB_HOST_SERVER_CA : path.resolve(certDir, 'eb-ca-crt.pem');

require('console-stamp')(console, {
    pattern: 'HH:MM:ss.l',
    metadata: `[server.${process.pid}]`.padEnd(8),
    colors: {
        stamp: ['blue'],
        label: ['white'],
        metadata: ['green']
    }
});

module.exports = function () {

    const self = this;

    const REMAIN_IN_QUEUE_MS = 12 * 60 * 60 * 1000;

    const options = {
        key: fs.readFileSync(ebServerKey),
        cert: fs.readFileSync(ebServerCert),
        ca: (ebServerCa) ? fs.readFileSync(ebServerCa) : null,
        requestCert: true,
        rejectUnauthorized: true
    };

    const ioServer = https.createServer(options);
    /*
        https://github.com/socketio/socket.io/issues/2769
        {
            upgradeTimeout: 30000,
            pingInterval: 25000,
            pingTimeout: 10000
        }
    */
    const io = require('socket.io')(ioServer);

    const EventEmitter = require('events');
    class JobEmitter extends EventEmitter { }

    const workerNodes = [];
    const queue = [];

    const workerSpace = io.of('/worker');
    workerSpace.on('connection', function (client) {

        client.on('register', (data, callback) => {

            if(data.oldSocketId != -1){
                /* 
                    in case of reconnect, find the worker based on 
                    the old socket ID and update it with the new one.
                */
                const worker = workerNodes.find((worker) => {
                    return (worker.id == data.oldSocketId);
                });
                if(worker){
                    console.log(`[worker.register] worker node re-registered. New Socket ID: ${data.id}, old Socket ID: ${data.oldSocketId}`);
                    worker.id = data.id;
                } else {
                    console.log(`[worker.register] no existing worker node found with old Socket ID: ${data.oldSocketId}`);
                }
            }

            const worker = workerNodes.find((worker) => {
                return (worker.id == data.id);
            });
            if (!worker)
                workerNodes.push({
                    id: data.id,
                    host: data.host,
                    platform: data.platform,
                    statistics: data.statistics,
                    status: 'connected',
                    assignedJobs: 0,
                    assignedExecutions: 0
                });

            console.log(`[worker.register] ${data.id} has connected. Total nodes: ${workerNodes.length}`);

            if (typeof callback === 'function') {
                // following environment variables are not shared with the worker node
                const exclude = [
                    'CICD_GULP_HOST_FQDN',
                    'CICD_EB_HOST_NAME', 
                    'CICD_EB_HOST_PORT', 
                    'CICD_EB_HOST_CLIENT_KEY',
                    'CICD_EB_HOST_CLIENT_CERT', 
                    'CICD_EB_HOST_CLIENT_CA', 
                    'CICD_EB_WORKER_CLUSTER_NUM',
                    'CICD_DB_MONGO_URL'];

                return callback(Object.keys(process.env).reduce((env, name) => {
                    if (name.startsWith('CICD_') && !exclude.includes(name)) {
                        env[name] = process.env[name]
                    }
                    return env;
                }, {}));
            }
            // make sure the worker node also pulls for new jobs
            client.emit('run');
           
        });

        client.on('get', (data, callback) => {
            ///console.log(client.id, 'is checking for work (/worker/get)');

            const nextPendingJob = queue.find((job) => {

                if (job.type == 'queue' && job.status == 'pending' && (job.host === undefined || job.host == data.host)) {
                    job.status = 'in progress';
                    job.started = Date.now();
                    job.runByClient = client.id;

                    // increase worker jobs assigned
                    workerNodes.some((worker) => {
                        if (worker.id == client.id) {
                            worker.assignedJobs++;
                        }
                    });

                    return true;
                }
            });

            if (typeof callback === 'function') {
                return callback(nextPendingJob ? {
                    id: nextPendingJob.id,
                    name: nextPendingJob.name,
                    background: nextPendingJob.background,
                    options: nextPendingJob.options
                } : null);
            }

        });

        client.on('background-in-progress', (inboundJob, callback) => {
            console.log(`[worker.background-in-progress] ${client.id} background in progress for Job: ${inboundJob.id} Type: ${inboundJob.type}`);

            var job = queue.find((job) => {
                return (job.id == inboundJob.id);
            });
            if (!job)
                return callback(Error(`Job not found with ID ${inboundJob.id}`));
            if (job.background !== true)
                return callback(Error(`This is not a background job ${job}`));

            // these can be setup errors
            job.result = inboundJob.result;
            job.error = inboundJob.error;

            job.runByClient = client.id;

            if (job.error !== undefined) {
                console.error('[worker.background-in-progress] AsyncJob setup failed on worker', { id: job.id, type: job.type, host: inboundJob.host, platform: inboundJob.platform, background: inboundJob.background }, job.error);
                job.status = 'background-setup-failed';
                job.emitter.emit('error', job.error);
            } else {
                // {id, result, host, platform}
                job.status = 'background-in-progress';
                job.emitter.emit('complete', { result: job.result, status: job.status, id: job.id, type: job.type, host: inboundJob.host, platform: inboundJob.platform, background: inboundJob.background });

            }

            if (typeof callback === 'function')
                return callback();
        });

        client.on('done', (inboundJob, callback) => {
            console.log(`[worker.done] ${client.id} is done (/worker/done) with Job: ${inboundJob.id} Type: ${inboundJob.type}`);

            var job = queue.find((job) => {
                return (job.id == inboundJob.id);
            });
            if (!job)
                return callback(Error(`Job not found with ID ${inboundJob.id}`));

            job.result = inboundJob.result;
            job.error = inboundJob.error;

            job.completed = Date.now();
            job.runByClient = client.id;

            if (job.error !== undefined) {
                console.error('[worker.done] Job failed on worker', { id: job.id, type: job.type, host: inboundJob.host, platform: inboundJob.platform, background: inboundJob.background }, '%j', job.error);
                job.status = 'failed';
                if (job.background !== true) {
                    job.emitter.emit('error', job.error);
                }
            } else {
                // {id, result, host, platform}
                job.status = 'complete';
                if (job.background !== true) {
                    job.emitter.emit('complete', { result: job.result, status: job.status, id: job.id, type: job.type, host: inboundJob.host, platform: inboundJob.platform, background: inboundJob.background });
                }
            }

            // remove completed jobs
            queue.forEach((eachJob, index, array) => {
                if (eachJob.completed && Date.now() - eachJob.completed > REMAIN_IN_QUEUE_MS) {
                    array.splice(index, 1);
                }
            });

            if (typeof callback === 'function')
                return callback();
        });

        client.on('disconnect', (reason) => {
            
            console.log(`[worker.disconnect] ${client.id} has disconnected. Reason: '${reason}', Nodes: ${workerNodes.length}`);

            workerNodes.some((worker, index) => {
                if (worker.id == client.id) {
                    workerNodes.splice(index, 1);
                    return true;
                }
            });

            console.log(`[worker.disconnect] Remaining nodes: ${workerNodes.length}`);

            /*
             *   find all jobs assigned to this worker and emit error
             */
            queue.filter((job) => {
                // find all jobs assigned to the worker
                return (job.runByClient == client.id && job.status == 'in progress');
            }).forEach((job) => {

                // trigger error events on these jobs
                console.error('[worker.disconnect] Job failed due to worker disconnected', '%j', job);
                job.status = 'failed';

                if (job.background !== true) {
                    job.emitter.emit('error', Error('worker disconnected'));
                }
            });

        });

        client.on('running', (data, callback) => {
            workerNodes.some((worker) => {
                if ((worker.id == client.id)) {
                    worker.status = 'running';
                    //console.log(client.id, "running - worker: ", worker);
                    return true;
                }
            });
            if (typeof callback === 'function')
                return callback();
        });

        client.on('paused', (data, callback) => {
            workerNodes.some((worker) => {
                if ((worker.id == client.id)) {
                    worker.status = 'paused';
                    worker.statistics = data.statistics
                    //console.log(client.id, "paused - worker: ", worker);
                    return true;
                }
            });
            if (typeof callback === 'function')
                return callback();
        });

        client.on('statistics', (data, callback) => {
            //console.log("STATUS: ", data)
            workerNodes.some((worker) => {
                if ((worker.id == client.id)) {
                    worker.statistics = data.statistics
                    return true;
                }
            });
            if (typeof callback === 'function')
                return callback();
        });

    });

    const busSpace = io.of('/bus');
    busSpace.on('connection', function (client) {

        //console.log(client.id, 'has connected to bus (/bus/connection).');

        /**
         * This is an immediate job execution.
         * This job will be pushed to the worker node which has the least load. 
         * If no worker are available, the job will fail.
         */
        client.on('run', ({ name, host, background, options, description }, callback) => {
            console.log(client.id, `has added a new RUN Job: '${name}' (Host: ${host})`);
            if (!workerNodes.length)
                return callback(Error(`No Worker Nodes available. name: ${name}, host: ${host}, background: ${background}, options: ${options}, description: ${description} }`));

            //console.log('workerNodes', workerNodes);

            const running = workerNodes.some(() => { // exclusive access to the array

                // get the pending ones
                const pending = workerNodes.filter((worker) => {
                    return (worker.status !== 'running' && (host === undefined || host == worker.host));
                });
                const available = (pending.length) ? pending : workerNodes.filter((worker) => {
                    return (host === undefined || host == worker.host);
                });

                const worker = available.sort((a, b) => {
                    // round robbin based on num of jobs instead of worker statistics
                    return (a.assignedJobs + a.assignedExecutions) - (b.assignedJobs + b.assignedExecutions); //a.statistics.num - b.statistics.num;
                })[0];

                worker.assignedExecutions++;

                console.log(`SERVER: EXE JOB ${name} with Worker: ${worker.id}.`)

                const emitter = new JobEmitter();
                emitter.once('complete', (out) => {
                    callback(null, out);
                });
                emitter.once('error', (err) => {
                    callback(err);
                });

                const job = {
                    type: 'exe',
                    name,
                    options,
                    host: worker.host,
                    background,
                    description,
                    id: uuidv4(),
                    emitter,
                    created: Date.now(),
                    completed: null,
                    workerId: worker.id
                }

                queue.push(job);
                //console.log('workerSpace.to(worker.id).emit(exe, job)', worker.id)
                workerSpace.to(worker.id).emit('exe', job);

                job.status = 'running';
                job.runByClient = worker.id;

                return true;
            });

            if (!running) {
                return callback(Error('No Worker Node found to execute the job.'));
            }

        });

        /** 
         * This is a queued job execution.
         * The job will be picked up by a random worker node.
         * The job will remain in the queue as long the worker nodes are busy.
        */
        client.on('queue', ({ name, host, background, options, description }, callback) => {
            console.log(client.id, `has added a new QUEUE Job: '${name}' (Host: ${host})`);

            if (!name) {
                callback(new Error('Job Not Defined (QUEUE)'));
                return;
            }

            const emitter = new JobEmitter();
            emitter.once('complete', (out) => {
                callback(null, out);
            });
            emitter.once('error', (err) => {
                callback(err);
            });

            queue.push({
                type: 'queue',
                name,
                options,
                host,
                background,
                description,
                id: uuidv4(),
                emitter: emitter,
                created: Date.now(),
                completed: null,
                status: 'pending'
            });

            workerSpace.emit('run');
        });

        client.on('housekeeping', ({ options, host }, callback) => {
            const hostWorker = workerNodes.find((worker) => {
                return (host == worker.host);
            });
            if (hostWorker) {
                workerSpace.to(hostWorker.id).emit('housekeeping', options);
                // there is no callback on broadcast to client.
                return callback(null, hostWorker);
            } else {
                return callback(Error(`No running worker node found on server ${host}`));
            }
        });
    });

    const dbSpace = io.of('/db');
    dbSpace.on('connection', function (client) {
        client.on('op', (param, callback) => {

            // console.log('[DB] ON-OB', param.table, param.operation, param.arguments);

            try {
                self.db[param.table][param.operation](...param.arguments).then((result) => {
                    return callback(null, result);
                }).catch((e) => {
                    // something is wrong with the db
                    console.error('[DB] ON-OB', param.table, param.operation, param.arguments);
                    console.error(e)
                    return callback(e);
                });
            } catch (e) {
                // object does not exist
                console.error('[DB] ON-OB', param.table, param.operation, param.arguments);
                console.error(e)
                return callback(e);
            }
        });

        client.on('register', (name, callback) => {
            return self.db.registerDataStore(name).then((result) => {
                callback(null, result);
            }).catch((e) => {
                callback(e);
            });
        });
    });

    ioServer.listen(ebPort);
    console.log("Event Bus listening on ", ebPort);

    return {
        getWorkerNodes: () => {
            return workerNodes.concat();
        },
        getJobs: () => {
            return queue.filter((job) => {
                return (job.type == 'queue');
            }).sort((a, b) => {
                return (b.created - a.created)
            });
        },
        getExeJobs: () => {
            return queue.filter((job) => {
                return (job.type == 'exe');
            }).sort((a, b) => {
                return (b.created - a.created)
            });
        },
        getJob: (id) => {
            return queue.find((job) => {
                return (job.id == id);
            });
        }
    };
};
