require('dotenv').config();

const fs = require('fs');
const https = require('https');
const uui = require('uuid/v4');
const path = require("path");

const certDir = path.join(__dirname, '../', '../', 'cert');

const ebPort = process.env.CICD_EB_HOST_PORT || 4443;
const ebServerKey = process.env.CICD_EB_HOST_SERVER_KEY || path.resolve(certDir, 'eb-server-key.pem');
const ebServerCert = process.env.CICD_EB_HOST_SERVER_CERT || path.resolve(certDir, 'eb-server-crt.pem');
const ebServerCa = (process.env.CICD_EB_HOST_SERVER_CA !== undefined) ? process.env.CICD_EB_HOST_SERVER_CA : path.resolve(certDir, 'eb-ca-crt.pem');


module.exports = function () {

    const self = this;
    
    var options = {
        key: fs.readFileSync(ebServerKey),
        cert: fs.readFileSync(ebServerCert),
        ca: (ebServerCa) ? fs.readFileSync(ebServerCa) : null,
        requestCert: true,
        rejectUnauthorized: true
    };

    const ioServer = https.createServer(options);
    const io = require('socket.io')(ioServer);

    const EventEmitter = require('events');
    class JobEmitter extends EventEmitter { }

    var workerNodes = [];
    var queue = [];

    const workerSpace = io.of('/worker');
    workerSpace.on('connection', function (client) {

        client.on('register', (data) => {

            var worker = workerNodes.find((worker) => {
                return (worker.id == data.id);
            });
            if (!worker)
                workerNodes.push({
                    id: data.id,
                    host: data.host,
                    platform: data.platform,
                    status: 'connected',
                    assignedJobs: 0
                });

            console.log(data.id, 'has connected (/worker/register).', 'Total nodes:', workerNodes.length);

            client.emit('run');
        });



        client.on('get', (data, callback) => {
            ///console.log(client.id, 'is checking for work (/worker/get)');

            const nextPendingJob = queue.find((job) => {

                if (job.status == 'pending' && (job.host === undefined || job.host == data.host)) {
                    job.status = 'in progress';

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
                    async :nextPendingJob.async,
                    options: nextPendingJob.options
                } : null);
            }

        });

        client.on('done', (inboundJob, callback) => {
            console.log(client.id, 'is done (/worker/done) with job:', inboundJob.id);

            var job = queue.find((job) => {
                return (job.id == inboundJob.id);
            });

            job.result = inboundJob.result;
            job.error = inboundJob.error;

            job.completed = Date.now();
            job.runByClient = client.id;

            if (job.error !== undefined) {
                console.error('Job failed on worker', {host: inboundJob.host, platform: inboundJob.platform, id: inboundJob.id}, job.error);
                job.status = 'failed';
                job.emitter.emit('error', job.error);
            } else {
                // {id, result, host, platform}
                job.status = 'complete';
                job.emitter.emit('complete', { result: job.result, host: inboundJob.host, platform: inboundJob.platform, id: inboundJob.id, async : inboundJob.async });
            }

            
            // remove completed jobs
            queue.forEach((eachJob, index, array) => {
                if (eachJob.completed && Date.now() - eachJob.completed > 100000) {
                    array.splice(index, 1);
                }
            });

            if (typeof callback === 'function')
                return callback();
        });

        client.on('disconnect', (data, callback) => {
            workerNodes.some((worker, index) => {
                if (worker.id == client.id) {
                    workerNodes.splice(index, 1);
                    return true;
                }
            });
            console.log(client.id, "has disconnected (/worker/disconnect). Remaining nodes:", workerNodes.length);
            if (typeof callback === 'function')
                return callback();

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
                    //console.log(client.id, "paused - worker: ", worker);
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

        client.on('run', ({name, host, async, options}, callback) => {
            console.log(client.id, `has added a new Job: '${name}' (Host: ${host})`);

            if (!name) {
                callback(new Error('Job Not Defined'));
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

                name: name,
                options: options,
                host: host,
                async: async, 
                
                id: uui(),
                status: 'pending',
                emitter: emitter,
                created: Date.now(),
                completed: null
            });

            workerSpace.emit('run');
        });
    });

    const dbSpace = io.of('/db');
    dbSpace.on('connection', function (client) {
        client.on('op', (param, callback) => {

            //console.log('[DB-Server]', client.id, 'added a new db operation (/db/op) ', param.table, param.operation); // , param.arguments
            
            try {
                self.db[param.table][param.operation](param.arguments).then((result) => {
                    /*
                    if (param.table == 'us' && param.operation == 'get') {
                        console.dir(param.arguments, { depth: null, colors: true });
                        console.log('[DB-Server]', 'result', result);
                    }
                    */
                    return callback(null, result);
                });
            } catch (e) {
                return callback(e);
            } 
        });
    });

    ioServer.listen(ebPort);
    console.log("Event Bus listening on ", ebPort);

    return {
        getWorkerNodes: () => {
            return workerNodes.concat();
        },
        getJobs: () => {
            return queue.concat();
        }
    };
};