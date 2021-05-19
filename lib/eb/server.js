const fs = require('fs-extra');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const crypto = require('crypto');
const { Mutex } = require('async-mutex');


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

module.exports = async function () {

    const self = this;

    const mutex = new Mutex();
    const queue = new Map();

    const serverIdFile = path.resolve(process.cwd(), '.server-id');
    
    let serverHash = crypto.randomBytes(16).toString('hex');
    const fileBody = {
        note: 'this file is automatically created by the CICD process, do not delete or edit!',
        id: serverHash
    };
    try {
        const exists = await fs.pathExists(serverIdFile);
        if (!exists)
            await fs.writeJson(serverIdFile, fileBody, { spaces: '\t' });

        const json = await fs.readJson(serverIdFile);
        if (!json.id)
            throw Error('id not found in file');

        serverHash = json.id;
    } catch (e) {
        console.warn(e);
        await fs.writeJson(serverIdFile, fileBody, { spaces: '\t' });
    }

    console.log(`Server ID: ${serverHash}`);

    // on startup, delete all worker nodes connected to this server
    const serverNodes = await self.db.worker_node.find({ serverHash });
    await Promise.all(serverNodes.map(async (node) => {
        console.log(`Removing old worker node ${node._id}`);
        await self.db.worker_node.delete(node);
    }));

    const removeIntervalMs = (70 * 1000);
    const removeDisconnected = async () => {
        const outdatedNodes = await self.db.worker_node.find({
            updatedAt: {
                $lt: Date.now() - removeIntervalMs
            }
        });
        await Promise.all(outdatedNodes.map(async (node) => {
            console.log(`Removing disconnected node ${node._id} on host ${node.host}`);
            await self.db.worker_node.delete(node);
        }));
    };
    await removeDisconnected();
    // periodically, delete all nodes which are disconnected
    setInterval(removeDisconnected, removeIntervalMs);


    const cleanupIntervalMs = (5 * 60 * 1000);
    const cleanupJobs = async () => {
        const completedJobs = await self.db.job_queue.find({
            $or: [{
                completed: {
                    $lt: Date.now() - cleanupIntervalMs
                }
            },
            {
                completed: null,
                updatedAt: {
                    $lt: Date.now() - (8 * 60 * 60 * 1000)
                }
            }]
        });
        await Promise.all(completedJobs.map(async (job) => {
            console.log(`Removing completed job '${job.name}' (${job._id})`);
            await self.db.job_queue.delete(job);
            queue.delete(job._id);
        }));
    };
    await cleanupJobs();
    // periodically, cleanup jobs
    setInterval(cleanupJobs, cleanupIntervalMs);


    const serverOptions = {
        key: fs.readFileSync(ebServerKey),
        cert: fs.readFileSync(ebServerCert),
        ca: (ebServerCa) ? fs.readFileSync(ebServerCa) : null,
        requestCert: true,
        rejectUnauthorized: true
    };

    const ioServer = https.createServer(serverOptions);
    /*
    https://github.com/socketio/socket.io/issues/2769
    {
        upgradeTimeout: 30000,
        pingInterval: 25000,
        pingTimeout: 10000
    }
*/
    const io = require('socket.io')(ioServer, {
        maxHttpBufferSize: 2e8 // 200MB, default value: 1e6 (1 MB)
    });

    const EventEmitter = require('events');
    class JobEmitter extends EventEmitter { }



    const STATUS_PENDING = 'pending';
    const STATUS_IN_PROGRESS = 'in progress';
    const STATUS_FAILED = 'failed';
    const STATUS_COMPLETE = 'complete';
    const STATUS_BACKGROUND_SETUP_FAILED = 'background-setup-failed';
    const STATUS_BACKGROUND_IN_PROGRESS = 'background-in-progress';

    const TYPE_QUEUE = 'queue';
    const TYPE_EXE = 'exe';

    const WORKER_STATUS_CONNECTED = 'connected';
    const WORKER_STATUS_RUNNING = 'running';
    const WORKER_STATUS_PAUSED = 'paused';

    // these variables are not shared with the worker node
    const DON_NOT_SYNC_ENV = [
        'CICD_GULP_HOST_FQDN',
        'CICD_EB_HOST_NAME',
        'CICD_EB_HOST_PORT',
        'CICD_EB_HOST_CLIENT_KEY',
        'CICD_EB_HOST_CLIENT_CERT',
        'CICD_EB_HOST_CLIENT_CA',
        'CICD_EB_WORKER_CLUSTER_NUM',
        'CICD_DB_MONGO_URL'];

    const workerSpace = io.of('/worker');
    workerSpace.on('connection', function (client) {

        client.on('register', async (data, callback) => {

            if (data.oldSocketId != -1) {
                /* 
                    in case of reconnect, find the worker based on 
                    the old socket ID and update it with the new one.
                */
                const oldWorker = await self.db.worker_node.findOne({ socketId: data.oldSocketId });
                if (oldWorker) {
                    console.log(`[worker.register] worker node re-registered. New Socket ID: ${data.id}, old Socket ID: ${data.oldSocketId}`);
                    await self.db.worker_node.update({ _id: oldWorker._id, id: data.id, disconnected: false });
                } else {
                    console.log(`[worker.register] no existing worker node found with old Socket ID: ${data.oldSocketId}`);
                }
            }

            let worker = await self.db.worker_node.findOne({ socketId: data.id });
            if (!worker) {
                worker = await self.db.worker_node.insert({
                    socketId: data.id,
                    serverHash,
                    host: data.host,
                    platform: data.platform,
                    statistics: data.statistics,
                    status: WORKER_STATUS_CONNECTED,
                    assignedJobs: 0,
                    assignedExecutions: 0,
                    disconnected: false
                });
            }

            // print statistics
            const workerNodes = await self.db.worker_node.find({ disconnected: false, serverHash });
            console.log(`[worker.register] ${worker.socketId} has connected. Total connected nodes: ${workerNodes.length}`);

            if (typeof callback === 'function') {
                return callback(Object.keys(process.env).reduce((env, name) => {
                    if (name.startsWith('CICD_') && !DON_NOT_SYNC_ENV.includes(name)) {
                        env[name] = process.env[name];
                    }
                    return env;
                }, {}));
            }
            // make sure the worker node also pulls for new jobs
            client.emit('run');

        });

        /** 
     * Worker node (client) pulls for jobs
     * */
        client.on('get', async (data, callback) => {

            ///console.log(client.id, 'is pulling for work (/worker/get)');

            await mutex.runExclusive(async () => {

                let pendingJob = await self.db.job_queue.findOne({
                    type: TYPE_QUEUE,
                    status: STATUS_PENDING,
                    host: {
                        $in: [null, data.host]
                    }
                });

                if (!pendingJob) {
                    if (typeof callback === 'function') {
                        return callback(null);
                    }
                    return;
                }

                const worker = await self.db.worker_node.findOne({ socketId: client.id });
                if (!worker)
                    throw Error(`Worker Node lookup failed with socketId: ${client.id}`);

                pendingJob = await self.db.job_queue.update({
                    _id: pendingJob._id,
                    workerId: worker._id,
                    status: STATUS_IN_PROGRESS,
                    started: Date.now()
                });

                // increase worker jobs assigned
                await self.db.worker_node.update({
                    _id: worker._id,
                    assignedJobs: worker.assignedJobs + 1
                });

                if (typeof callback === 'function') {
                    return callback(pendingJob);
                }

            });

        });


        /**
     * Worker node (client) informs that job has started and is 'background-in-progress'
     */
        client.on('background-in-progress', async (job, callback = () => { }) => {

            console.log(`[worker.background-in-progress] ${client.id} background in progress for Job: ${job._id} Type: ${job.type}`);

            if (!queue.has(job._id)) {
                await self.db.job_queue.delete(job);
                console.error(`'background-in-progress' : job id '${job._id}' not found in queue map.`);
                return callback();
            }

            if (job.background !== true) {
                console.error(`This is not a background job ${job}`);
                return callback();
            }

            job.completed = Date.now();

            if (job.error !== undefined) {
                console.error('[worker.background-in-progress] AsyncJob setup failed on worker', job, '%j', job.error);
                job.status = STATUS_BACKGROUND_SETUP_FAILED;
                // emit the 'error' event on the queued job
                queue.get(job._id).emit('error', job.error);

            } else {
                job.status = STATUS_BACKGROUND_IN_PROGRESS;
                // emit the 'complete' event on the queued job
                queue.get(job._id).emit('complete', job);

            }

            // remove the job from the ram queue
            queue.delete(job._id);

            await self.db.job_queue.update({
                _id: job._id,
                result: job.result,
                error: job.error,
                status: job.status,
                completed: job.completed
            });

            if (typeof callback === 'function')
                return callback();

        });


        /**
     * Worker node (client) informs that job running is completed
     */
        client.on('done', async (job, callback = () => { }) => {

            console.log(`[worker.done] ${client.id} is done with Job: ${job._id} Type: ${job.type}`);

            if (!queue.has(job._id)) {
                await self.db.job_queue.delete(job);
                console.error(`'done' : job id '${job._id}' not found in queue map.`);
                return callback();
            }

            job.completed = Date.now();

            if (job.error !== undefined) {
                console.error('[worker.done] Job failed on worker', job, '%j', job.error);
                job.status = STATUS_FAILED;
                if (job.background !== true) {
                    // emit the 'error' event on the queued job
                    queue.get(job._id).emit('error', job.error);
                }
            } else {
                job.status = STATUS_COMPLETE;
                if (job.background !== true) {
                    // emit the 'complete' event on the queued job
                    queue.get(job._id).emit('complete', job);
                }
            }

            // remove the job from the ram queue
            queue.delete(job._id);

            await self.db.job_queue.update({
                _id: job._id,
                result: job.result,
                error: job.error,
                status: job.status,
                completed: job.completed
            });

            return callback();
        });

        client.on('disconnect', async (reason) => {

            const socketId = client.id;
            const duration = 60;

            console.log(`[worker.disconnect] ${socketId} has disconnected. Reason: '${reason}'`);


            const disconnectedWorker = await self.db.worker_node.findOne({ socketId: socketId });
            if (disconnectedWorker) {
                console.log(`[worker.disconnect] Worker marked as disconnected: ${disconnectedWorker._id}`);

                await self.db.worker_node.update({ _id: disconnectedWorker._id, disconnected: true });
            } else {
                console.log(`[worker.disconnect] Disconnected Worker Node not found. ID: ${socketId}`);
                return;
            }


            // find all jobs assigned to the worker
            let runningJobs = await self.db.job_queue.find({ workerId: disconnectedWorker._id, status: STATUS_IN_PROGRESS });

            console.log(`[worker.disconnect] Disconnected client had '${runningJobs.length}' running jobs. Wait for ${duration} seconds for it to reconnect.`);

            setTimeout(async (_id) => {

                // in case the worker came back, the ID has changed. So if it can not be found with the old one this means OK
                const reconnectedWorker = await self.db.worker_node.findOne({ _id, disconnected: false });
                if (reconnectedWorker) {
                    console.log('[worker.disconnect] Disconnected Worker Node reconnected successfully.');
                    return;
                }

                // in case the worker is still in the list, it did not reconnect within ${duration}

                console.warn(`[worker.disconnect] Disconnected Worker Node did not reconnect in ${duration} seconds. Remove it from the nodes list now.`);

                // remove the worker from the list
                await self.db.worker_node.delete({ _id });


                const workerNodes = await self.db.worker_node.find({ disconnected: false, serverHash });
                console.warn(`[worker.disconnect] Removed. Remaining connected nodes: ${workerNodes.length}`);

                /*
             *   find all 'STATUS_IN_PROGRESS' jobs assigned to this worker and emit error
             */
                runningJobs = await self.db.job_queue.find({ workerId: _id, status: STATUS_IN_PROGRESS });
                await Promise.all(runningJobs.map(async (job) => {

                    // trigger error events on these jobs
                    console.error('[worker.disconnect] Job failed due to worker disconnected', '%j', job);

                    await self.db.job_queue.update({ _id: job._id, status: 'failed' });
                    if (job.background !== true) {

                        queue.get(job._id).emit('error', Error('worker disconnected'));
                    }

                }));

            }, duration * 1000, disconnectedWorker._id);

        });

        client.on('running', async (data, callback) => {

            const worker = await self.db.worker_node.findOne({ socketId: client.id });
            await self.db.worker_node.update({ _id: worker._id, status: WORKER_STATUS_RUNNING });
            if (typeof callback === 'function')
                return callback();

        });

        client.on('paused', async (data, callback) => {

            const worker = await self.db.worker_node.findOne({ socketId: client.id });
            await self.db.worker_node.update({ _id: worker._id, status: WORKER_STATUS_PAUSED, statistics: data.statistics });

            if (typeof callback === 'function')
                return callback();

        });

        client.on('statistics', async (data, callback) => {

            const worker = await self.db.worker_node.findOne({ socketId: client.id });
            await self.db.worker_node.update({ _id: worker._id, statistics: data.statistics });

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
        client.on('run', async ({ name, host, background, options, description }, callback) => {

            console.log(`Client ${client.id} added a new RUN Job: '${name}'`, host ? `(Host: ${host})` : '');

            await mutex.runExclusive(async () => {

                const workerNodes = await self.db.worker_node.find({ disconnected: false, serverHash });
                if (!workerNodes.length)
                    return callback(Error(`No Worker Nodes available. name: ${name}, host: ${host}, background: ${background}, options: ${options}, description: ${description} }`));

                // get the pending ones out of the connected
                const pending = workerNodes.filter((_worker) => {
                    return (_worker.status !== WORKER_STATUS_RUNNING && (host === undefined || host == _worker.host));
                });

                // if get the available ones from pending or connected
                const available = (pending.length) ? pending : workerNodes.filter((_worker) => {
                    return (host === undefined || host == _worker.host);
                });

                if (!available.length)
                    return callback(Error(`No Worker Nodes available. name: ${name}, host: ${host}, background: ${background}, options: ${options}, description: ${description} }`));

                const worker = available.sort((a, b) => {
                    // round robbin based on num of jobs instead of worker statistics
                    return (a.assignedJobs + a.assignedExecutions) - (b.assignedJobs + b.assignedExecutions); //a.statistics.num - b.statistics.num;
                })[0];

                if (!worker)
                    return callback(Error('No Worker Node found to execute the job.'));


                console.log(`SERVER: EXE JOB ${name} with Worker: ${worker.socketId}.`);

                const emitter = new JobEmitter();
                emitter.once('complete', (out) => {
                    callback(null, out);
                });
                emitter.once('error', (err) => {
                    callback(err);
                });

                const job = await self.db.job_queue.insert({
                    type: TYPE_EXE,
                    name,
                    options,
                    host: worker.host,
                    background,
                    description,
                    created: Date.now(),
                    completed: null,
                    workerId: worker._id
                });

                try {
                    // save the emitter
                    queue.set(job._id, emitter);

                    // emit job on client
                    workerSpace.to(worker.socketId).emit('exe', job);

                    await self.db.job_queue.update({ _id: job._id, status: 'running', runByClient: worker._id });

                    await self.db.worker_node.update({ _id: worker._id, assignedExecutions: worker.assignedExecutions + 1 });

                } catch (e) {
                    console.error(`Failed to execute job ${job._id} in worker ${worker._id}`, e);
                    queue.delete(job._id);
                    throw e;
                }
            });
            return true;
        });

        /** 
     * This is a queued job execution.
     * The job will be picked up by a random worker node.
     * The job will remain in the queue as long the worker nodes are busy.
    */
        client.on('queue', async ({ name, host, background, options, description }, callback) => {
            console.log(`Client ${client.id} added a new QUEUE Job: '${name}'`, host ? `(Host: ${host})` : '');

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

            const job = await self.db.job_queue.insert({
                type: TYPE_QUEUE,
                name,
                options,
                host,
                background,
                description,
                created: Date.now(),
                completed: null,
                status: STATUS_PENDING
            });
            queue.set(job._id, emitter);

            // inform all worker nodes about the new job
            workerSpace.emit('run');

        });


        client.on('housekeeping', async ({ options, host }, callback) => {
            const hostWorker = await self.db.worker_node.findOne({ host });
            if (hostWorker) {
                console.log(`execute housekeeping on '${host}' with worker ${hostWorker.socketId}`);
                workerSpace.to(hostWorker.socketId).emit('housekeeping', options);
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
                    console.error(e);
                    return callback(e);
                });
            } catch (e) {
                // object does not exist
                console.error('[DB] ON-OB', param.table, param.operation, param.arguments);
                console.error(e);
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
    console.log('Event Bus listening on ', ebPort);

    return {
        getWorkerNodes: async () => {
            return self.db.worker_node.find({});
        },
        getJobs: async () => {
            return self.db.job_queue.find({ type: TYPE_QUEUE }, (query) => query.sort('-created'));
        },
        getExeJobs: async () => {
            return self.db.job_queue.find({ type: TYPE_EXE }, (query) => query.sort('-created'));

        },
        getJob: async (id) => {
            return self.db.job_queue.find({ id });
        }
    };
};
