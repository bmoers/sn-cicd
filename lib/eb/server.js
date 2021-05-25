const fs = require('fs-extra');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const crypto = require('crypto');
const { Mutex } = require('async-mutex');
const chalk = require('chalk');

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


    // get all jobs assigned to this server
    const stalledJobs = await self.db.job_queue.find({
        serverHash,
        //status: STATUS_PENDING
    });

    // delete all jobs assigned to this server
    await Promise.all(stalledJobs.map(async (job) => {
        console.log(`Removing stalled job ${job._id}`);
        await self.db.job_queue.delete(job);
    }));

    // get all worker nodes of this server
    const serverNodes = await self.db.worker_node.find({ serverHash });
    // delete all worker nodes connected to this server
    await Promise.all(serverNodes.map(async (node) => {
        console.log(`Removing old worker node ${node._id} with socketId ${node.socketId}`);
        await self.db.worker_node.delete(node);
    }));

    // periodically check for worker nodes which have not updated
    const removeIntervalMs = (90 * 1000);
    setInterval(async () => {
        const outdatedNodes = await self.db.worker_node.find({
            serverHash,
            updatedAt: {
                $lt: Date.now() - removeIntervalMs
            }
        });
        await Promise.all(outdatedNodes.map(async (node) => {
            console.log(`Removing disconnected node ${node._id} with socketId ${node.socketId} on host ${node.host}`);
            await self.db.worker_node.delete(node);
        }));
    }, removeIntervalMs);


    // periodically remove completed jobs
    const cleanupIntervalMs = (15 * 60 * 1000);
    setInterval(async () => {
        const serverNodes = await self.db.worker_node.find({ serverHash });
        const completedJobs = await self.db.job_queue.find({
            workerId: { $in: serverNodes.map(n => n._id) },
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
            // also remove the event emitter
            queue.delete(job._id);
        }));
    }, cleanupIntervalMs);


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
    workerSpace.on('connection', function (socket) {

        socket.on('register', async (data, callback = () => { }) => {

            if (data.oldSocketId != -1) {
                /* 
                    in case of reconnect, find the worker based on 
                    the old socket ID and update it with the new one.
                */
                const oldWorker = await self.db.worker_node.findOne({ socketId: data.oldSocketId });
                if (oldWorker) {
                    console.log(`${chalk.green(`[${socket.id}]`)} : [worker.register] worker node re-registered. New Socket ID: ${data.id}, old Socket ID: ${data.oldSocketId}`);
                    await self.db.worker_node.update({ _id: oldWorker._id, id: data.id, disconnected: false });
                } else {
                    console.log(`${chalk.green(`[${socket.id}]`)} : [worker.register] no existing worker node found with old Socket ID: ${data.oldSocketId}`);
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
            console.log(`${chalk.green(`[${socket.id}]`)} : [worker.register] worker ${worker.socketId} connected. Total connected nodes: ${workerNodes.length}`);


            callback(Object.keys(process.env).reduce((env, name) => {
                if (name.startsWith('CICD_') && !DON_NOT_SYNC_ENV.includes(name)) {
                    env[name] = process.env[name];
                }
                return env;
            }, {}));

            // make sure the worker node also pulls for new jobs
            socket.emit('run');

        });

        /** 
         * Worker node (client) pulls for jobs
         * */
        socket.on('get', async (data, callback = () => { }) => {

            //console.log(socket.id, 'is pulling for work (/worker/get)', data);

            await mutex.runExclusive(async () => {

                // if jobId is set the request comes from the worker exec() function
                const exeJob = !!(data.jobId && data.workerId);


                // check the worker is known
                let workerQuery = {};
                if (exeJob) {
                    workerQuery = { _id: data.workerId };
                } else {
                    workerQuery = { socketId: socket.id };
                }
                const worker = await self.db.worker_node.findOne(workerQuery);
                if (!worker)
                    throw Error('Worker lookup failed with query: ', workerQuery);


                // check for exclusive jobs running
                const exclusiveRunningJobs = await self.db.job_queue.find({
                    exclusiveId: { $ne: null },
                    status: { $in: [STATUS_IN_PROGRESS, STATUS_BACKGROUND_IN_PROGRESS] }
                });
                const exclusiveRunningJobIds = exclusiveRunningJobs.map((j) => j.exclusiveId);

                // only pull for jobs which are not already exclusively running
                let query = {};
                if (exeJob) {
                    query = {
                        _id: data.jobId,
                        workerId: data.workerId,
                        status: STATUS_PENDING,
                        exclusiveId: { $nin: exclusiveRunningJobIds }
                    };
                } else {
                    query = {
                        type: TYPE_QUEUE,
                        serverHash,
                        status: STATUS_PENDING,
                        host: {
                            $in: [null, data.host]
                        },
                        exclusiveId: { $nin: exclusiveRunningJobIds }
                    };
                }
                let pendingJob = await self.db.job_queue.findOne(query);

                // no pending jobs, or locked pending jobs
                if (!pendingJob) {

                    // but some exclusive jobs
                    if (exclusiveRunningJobIds.length) {

                        let nextQuery = {};
                        if (exeJob) {
                            // if the current job was not found, another one with the same exclusiveId was running
                            // check if the current exe job is still in the queue
                            nextQuery = {
                                _id: data.jobId,
                                workerId: data.workerId,
                                status: STATUS_PENDING,
                            };
                        } else {
                            // check if there are more queue jobs 
                            nextQuery = {
                                type: TYPE_QUEUE,
                                serverHash,
                                status: STATUS_PENDING,
                                host: {
                                    $in: [null, data.host]
                                },
                                exclusiveId: { $ne: null },
                            };
                        }
                        // check if there is at least one pending job
                        const nextJob = await self.db.job_queue.findOne(nextQuery);

                        // tell the worker, there are more jobs to be completed
                        if (nextJob) {
                            return callback({ exclusiveLock: true });
                        }
                    }

                    // all done, no further jobs
                    return callback(null);
                }

                if (!queue.has(pendingJob._id)) {
                    console.error(`${chalk.green(`[${socket.id}]`)} : [worker.get] : EventEmitter not available! Job id '${pendingJob._id}' not found in queue map.`);
                    await self.db.job_queue.delete(pendingJob);
                    return callback(null);
                }


                pendingJob = await self.db.job_queue.update({
                    _id: pendingJob._id,
                    workerId: worker._id,
                    status: STATUS_IN_PROGRESS,
                    started: Date.now()
                });

                if (!exeJob) {
                    // increase worker jobs assigned
                    await self.db.worker_node.update({
                        _id: worker._id,
                        assignedJobs: worker.assignedJobs + 1
                    });
                }

                return callback(pendingJob);

            });

        });


        /**
         * Worker node (client) informs that job has started and is 'background-in-progress'
         */
        socket.on('background-in-progress', async (job, callback = () => { }) => {

            console.log(`${chalk.green(`[${socket.id}]`)} : [worker.background-in-progress] : job '${job.name}' (_id: ${job._id} / type: ${job.type} / host: ${job.host}) background job started`);
            
            if (!queue.has(job._id)) {
                await self.db.job_queue.delete(job);
                console.error(`${chalk.green(`[${socket.id}]`)} : [worker.background-in-progress] : EventEmitter not available! Job '${job.name}' (_id: ${job._id} / type: ${job.type} / host: ${job.host}) not found in queue map.`);
                return callback();
            }

            if (job.background !== true) {
                console.error(`${chalk.green(`[${socket.id}]`)} : [worker.background-in-progress] : This is not a background job`, job);
                return callback();
            }

            job.started = Date.now();

            if (job.error !== undefined) {
                //console.error('[worker.background-in-progress] AsyncJob setup failed %j', job, '%j', job.error);

                const returnJob = await self.db.job_queue.update({
                    _id: job._id,
                    result: job.result,
                    error: job.error,
                    status: STATUS_BACKGROUND_SETUP_FAILED,
                    started: job.started,
                    host: job.host,
                    platform: job.platform,
                });

                // emit the 'error' event on the queued job
                queue.get(job._id).emit('setup-error', returnJob);

            } else {

                const returnJob = await self.db.job_queue.update({
                    _id: job._id,
                    status: STATUS_BACKGROUND_IN_PROGRESS,
                    started: job.started,
                    host: job.host,
                    platform: job.platform,
                });

                // emit the 'started' event on the queued job
                queue.get(job._id).emit('started', returnJob);

            }

            return callback();

        });


        /**
         * Worker node (client) informs that job running is completed
         */
        socket.on('done', async (job, callback = () => { }) => {

            console.log(`${chalk.green(`[${socket.id}]`)} : [worker.done] : job '${job.name}' (_id: ${job._id} / type: ${job.type} / host: ${job.host})`);


            if (!queue.has(job._id)) {
                await self.db.job_queue.delete(job);
                console.error(`${chalk.green(`[${socket.id}]`)} : [worker.done] : EventEmitter not available! Job '${job.name}' (_id: ${job._id} / type: ${job.type} / host: ${job.host}) not found in queue map.`);
                return callback();
            }

            job.completed = Date.now();

            if (job.error !== undefined) {
                //console.error('[worker.done] Job failed %j', job, job.error);

                const returnJob = await self.db.job_queue.update({
                    _id: job._id,
                    result: job.result,
                    error: job.error,
                    status: STATUS_FAILED,
                    completed: job.completed,
                    host: job.host,
                    platform: job.platform,
                });

                // emit the 'error' event on the queued job
                queue.get(job._id).emit('error', returnJob);

            } else {

                const returnJob = await self.db.job_queue.update({
                    _id: job._id,
                    result: job.result,
                    error: job.error,
                    status: STATUS_COMPLETE,
                    completed: job.completed,
                    host: job.host,
                    platform: job.platform,
                });

                // emit the 'complete' event on the queued job
                queue.get(job._id).emit('complete', returnJob);

            }

            // remove the job from the ram queue
            queue.delete(job._id);

            return callback();
        });

        socket.on('disconnect', async (reason) => {

            const socketId = socket.id;
            const duration = 60;

            console.log(`${chalk.green(`[${socket.id}]`)} : [worker.disconnect] ${socketId} has disconnected. Reason: '${reason}'`);

            const disconnectedWorker = await self.db.worker_node.findOne({ socketId: socketId });
            if (disconnectedWorker) {
                await self.db.worker_node.update({ _id: disconnectedWorker._id, disconnected: true });
                console.log(`${chalk.green(`[${socket.id}]`)} : [worker.disconnect] Worker marked as disconnected: ${disconnectedWorker._id}`);
            } else {
                console.log(`${chalk.green(`[${socket.id}]`)} : [worker.disconnect] Disconnected Worker Node not found. ID: ${socketId}`);
                return;
            }


            // find all jobs assigned to the worker
            let runningJobs = await self.db.job_queue.find({ workerId: disconnectedWorker._id, status: { $in: [STATUS_IN_PROGRESS, STATUS_BACKGROUND_IN_PROGRESS] } });

            console.log(`${chalk.green(`[${socket.id}]`)} : [worker.disconnect] Disconnected client had '${runningJobs.length}' running jobs. Wait for ${duration} seconds for it to reconnect.`);

            setTimeout(async (_id) => {

                // in case the worker came back, the ID has changed. So if it can not be found with the old one this means OK
                const reconnectedWorker = await self.db.worker_node.findOne({ _id, disconnected: false });
                if (reconnectedWorker) {
                    console.log('[${chalk.green(socket.id)}] : [worker.disconnect] Disconnected Worker Node reconnected successfully.');
                    return;
                }

                // in case the worker is still in the list, it did not reconnect within ${duration}

                console.warn(`${chalk.green(`[${socket.id}]`)} : [worker.disconnect] Disconnected Worker Node ${socketId} did not reconnect in ${duration} seconds. Remove it from the nodes list now. (${_id})`);

                // remove the worker from the list
                await self.db.worker_node.delete({ _id });


                const workerNodes = await self.db.worker_node.find({ disconnected: false, serverHash });
                console.warn(`${chalk.green(`[${socket.id}]`)} : [worker.disconnect] Removed. Remaining connected nodes: ${workerNodes.length}`);

                /*
                *   find all 'STATUS_IN_PROGRESS' jobs assigned to this worker and emit error
                */
                runningJobs = await self.db.job_queue.find({ workerId: _id, status: { $in: [STATUS_IN_PROGRESS, STATUS_BACKGROUND_IN_PROGRESS] } });
                await Promise.all(runningJobs.map(async (job) => {

                    // trigger error events on these jobs
                    console.error(`${chalk.green(`[${socket.id}]`)} : [worker.disconnect] Job failed due to worker disconnected'`, job);

                    await self.db.job_queue.update({ _id: job._id, status: 'failed' });
                    if (job.background !== true) {

                        queue.get(job._id).emit('error', {
                            error: Error('worker disconnected')
                        });
                    }

                }));

            }, duration * 1000, disconnectedWorker._id);

        });

        socket.on('running', async (data, callback = () => { }) => {

            const worker = await self.db.worker_node.findOne({ socketId: socket.id });
            if (!worker) {
                console.error(`${chalk.green(`[${socket.id}]`)} : [worker.running] worker node not found with socketId ${socket.id}`);
                return callback();
            }

            await self.db.worker_node.update({ _id: worker._id, status: WORKER_STATUS_RUNNING });
            callback();

        });

        socket.on('paused', async (data, callback = () => { }) => {

            const worker = await self.db.worker_node.findOne({ socketId: socket.id });
            if (!worker) {
                console.error(`${chalk.green(`[${socket.id}]`)} : [worker.paused] worker node not found with socketId ${socket.id}`);
                return callback();
            }

            await self.db.worker_node.update({ _id: worker._id, status: WORKER_STATUS_PAUSED, statistics: data.statistics });
            callback();

        });

        socket.on('statistics', async (data, callback = () => { }) => {

            const worker = await self.db.worker_node.findOne({ socketId: socket.id });
            if (!worker) {
                console.error(`${chalk.green(`[${socket.id}]`)} : [worker.statistics] worker node not found with socketId ${socket.id}`);
                return callback();
            }

            await self.db.worker_node.update({ _id: worker._id, statistics: data.statistics });
            callback();

        });


    });

    // https://stackoverflow.com/questions/26400595/socket-io-how-do-i-remove-a-namespace/36499839
    /*
    const closeEventBus = () => {
        const connectedNameSpaceSockets = Object.keys(busSpace.connected); // Get Object with Connected SocketIds as properties
        connectedNameSpaceSockets.forEach(socketId => {
            busSpace.connected[socketId].disconnect(); // Disconnect Each socket
        });
        busSpace.removeAllListeners(); // Remove all Listeners for the event emitter
        delete io.nsps['/bus']; // Remove from the server namespaces
    };
    */

    const busSpace = io.of('/bus');
    busSpace.on('connection', function (socket) {

        //console.log('client', socket.id, 'connected to bus (/bus/connection).');

        /**
         * This is an immediate job execution.
         * This job will be pushed to the worker node which has the least load. 
         * If no worker are available, the job will fail.
         */
        socket.on('run', async ({ name, host = null, background = false, options, description, exclusiveId = null }, callback = () => { }) => {

            if (!name) {
                callback(new Error('[bus.run] : job name not defined'));
                return;
            }

            await mutex.runExclusive(async () => {

                const workerNodes = await self.db.worker_node.find({ disconnected: false, serverHash });
                if (!workerNodes.length)
                    return callback(Error(`No Worker Nodes available. name: ${name}, host: ${host}, background: ${background}, options: ${options}, description: ${description} }`));

                // get the pending ones out of the connected
                const pending = workerNodes.filter((_worker) => {
                    return (_worker.status !== WORKER_STATUS_RUNNING && (host === null || host == _worker.host));
                });

                // if get the available ones from pending or connected
                const available = (pending.length) ? pending : workerNodes.filter((_worker) => {
                    return (host === null || host == _worker.host);
                });

                if (!available.length)
                    return callback(Error(`No Worker Nodes available. name: ${name}, host: ${host}, background: ${background}, options: ${options}, description: ${description} }`));

                const worker = available.sort((a, b) => {
                    // round robbin based on num of jobs instead of worker statistics
                    return (a.assignedJobs + a.assignedExecutions) - (b.assignedJobs + b.assignedExecutions); //a.statistics.num - b.statistics.num;
                })[0];

                if (!worker)
                    return callback(Error('No Worker Node found to execute the job.'));

                const job = await self.db.job_queue.insert({
                    serverHash,
                    type: TYPE_EXE,
                    name,
                    options,
                    host: worker.host,
                    background,
                    description,
                    created: Date.now(),
                    completed: null,
                    status: STATUS_PENDING,
                    exclusiveId,
                    workerId: worker._id
                });

                console.log(`${chalk.green(`[${socket.id}]`)} : [bus.run] : new job '${job.name}' (_id: ${job._id} / type: ${job.type} / host: ${job.host}) on worker: ${worker.socketId}`);

                const emitter = new JobEmitter();

                if (background) {
                    emitter.once('setup-error', (out) => {
                        console.error(`${chalk.green(`[${socket.id}]`)} : [bus.run] : background job setup error: '${out.name}' (_id: ${out._id} / type: ${out.type} / host: ${out.host})`, out.error);
                    });
                    emitter.once('started', (out) => {
                        console.log(`${chalk.green(`[${socket.id}]`)} : [bus.run] : background job started: '${out.name}' (_id: ${out._id} / type: ${out.type} / host: ${out.host}), StartedAt: ${new Date(out.started).toISOString()}`);
                    });
                    emitter.once('error', (out) => {
                        console.error(`${chalk.green(`[${socket.id}]`)} : [bus.run] : background job error: '${out.name}' (_id: ${out._id} / type: ${out.type} / host: ${out.host})`, out.error);
                    });
                    emitter.once('complete', (out) => {
                        console.log(`${chalk.green(`[${socket.id}]`)} : [bus.run] : background job completed: '${out.name}' (_id: ${out._id} / type: ${out.type} / host: ${out.host}), CompletedAt: ${new Date(out.completed).toISOString()}`);
                    });

                    callback(null, {
                        _id: job._id
                    });

                } else {
                    emitter.once('complete', (out) => {
                        callback(null, out);
                    });
                    emitter.once('error', (out) => {
                        callback(out.error);
                    });
                }


                try {
                    // save the emitter
                    queue.set(job._id.toString(), emitter);

                    // emit job on client
                    workerSpace.to(worker.socketId).emit('exe', { jobId: job._id, workerId: job.workerId });

                    // increase statistics
                    await self.db.worker_node.update({
                        _id: job.workerId,
                        assignedExecutions: worker.assignedExecutions + 1
                    });

                } catch (e) {
                    console.error(`${chalk.green(`[${socket.id}]`)} : [bus.run] : failed to execute job '${job.name}' (_id: ${job._id} / type: ${job.type} / host: ${job.host}) on worker ${worker._id}`, e);
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
        socket.on('queue', async ({ name, host = null, background = true, options, description, exclusiveId = null }, callback = () => { }) => {

            if (!name) {
                callback(new Error('[bus.queue] : job name not defined'));
                return;
            }

            const job = await self.db.job_queue.insert({
                serverHash,
                type: TYPE_QUEUE,
                name,
                options,
                host,
                background,
                description,
                created: Date.now(),
                completed: null,
                status: STATUS_PENDING,
                exclusiveId
            });

            console.log(`${chalk.green(`[${socket.id}]`)} : [bus.queue] : new job '${job.name}' (_id: ${job._id} / type: ${job.type} / host: ${job.host})`);

            const emitter = new JobEmitter();

            if (background) {
                emitter.once('setup-error', (out) => {
                    console.error(`${chalk.green(`[${socket.id}]`)} : [bus.queue] : background job setup error: '${out.name}' (_id: ${out._id} / type: ${out.type} / host: ${out.host})`, out.error);
                });
                emitter.once('started', (out) => {
                    console.log(`${chalk.green(`[${socket.id}]`)} : [bus.queue] : background job started: '${out.name}' (_id: ${out._id} / type: ${out.type} / host: ${out.host}), StartedAt: ${new Date(out.started).toISOString()}`);
                });
                emitter.once('error', (out) => {
                    console.error(`${chalk.green(`[${socket.id}]`)} : [bus.queue] : background job error: '${out.name}' (_id: ${out._id} / type: ${out.type} / host: ${out.host})`, out.error);
                });
                emitter.once('complete', (out) => {
                    console.log(`${chalk.green(`[${socket.id}]`)} : [bus.queue] : background job completed: '${out.name}' (_id: ${out._id} / type: ${out.type} / host: ${out.host}), CompletedAt: ${new Date(out.completed).toISOString()}`);
                });

                callback(null, {
                    _id: job._id
                });

            } else {
                emitter.once('complete', (out) => {
                    callback(null, out);
                });
                emitter.once('error', (out) => {
                    callback(out.error);
                });
            }

            try {
                // save the emitter
                queue.set(job._id, emitter);

                // inform all worker nodes about the new job
                workerSpace.emit('run');

            } catch (e) {
                console.error(`${chalk.green(`[${socket.id}]`)} : [bus.queue] : failed to 'run' queue job '${job.name}' (_id: ${job._id} / type: ${job.type} / host: ${job.host})`, e);
                queue.delete(job._id);
                throw e;
            }

        });


        socket.on('housekeeping', async ({ options, host }, callback = () => { }) => {
            const hostWorker = await self.db.worker_node.findOne({ host });
            if (hostWorker) {
                console.log(`${chalk.green(`[${socket.id}]`)} : [bus.housekeeping] : execute housekeeping on '${host}' with worker ${hostWorker.socketId}`);
                workerSpace.to(hostWorker.socketId).emit('housekeeping', options);
                // there is no callback on broadcast to client.
                return callback(null, hostWorker);
            } else {
                return callback(Error(`No running worker node found on server ${host}`));
            }
        });

    });

    const dbSpace = io.of('/db');
    dbSpace.on('connection', function (socket) {

        socket.on('op', (param, callback) => {

            // console.log('[DB] ON-OB', param.table, param.operation, param.arguments);

            try {
                self.db[param.table][param.operation](...param.arguments).then((result) => {
                    return callback(null, result);
                }).catch((e) => {
                    // something is wrong with the db
                    console.error(`${chalk.green(`[${socket.id}]`)} : [db.op] :`, param.table, param.operation, param.arguments);
                    console.error(e);
                    return callback(e);
                });
            } catch (e) {
                // object does not exist
                console.error(`${chalk.green(`[${socket.id}]`)} : [db.op] :`, param.table, param.operation, param.arguments);
                console.error(e);
                return callback(e);
            }
        });

        socket.on('register', (name, callback) => {
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
            return self.db.job_queue.findOne({ _id: id });
        }
    };
};
