const fs = require('fs');
const io = require('socket.io-client');
const path = require('path');
const chalk = require('chalk');

const certDir = path.join(__dirname, '../', '../', 'cert');

const ebHost = process.env.CICD_EB_HOST_NAME || 'localhost';
const ebPort = process.env.CICD_EB_HOST_PORT || 4443;
const ebClientKey = process.env.CICD_EB_HOST_CLIENT_KEY || path.resolve(certDir, 'eb-client-key.pem');
const ebClientCert = process.env.CICD_EB_HOST_CLIENT_CERT || path.resolve(certDir, 'eb-client-crt.pem');
const ebClientCa = (process.env.CICD_EB_HOST_CLIENT_CA !== undefined) ? process.env.CICD_EB_HOST_CLIENT_CA : path.resolve(certDir, 'eb-ca-crt.pem');

const socketOptions = {
    key: fs.readFileSync(ebClientKey),
    cert: fs.readFileSync(ebClientCert),
    ca: (ebClientCa) ? fs.readFileSync(ebClientCa) : null
};

/**
 * Immediately execute a job on a worker on the event bus.
 * Once the job is completed, the promise will be resolved.
 *
 * @param {Object} opt The settings below
 * @param {String} opt.name the name of the job-module
 * @param {String} opt.host assign the jot to a dedicated host
 * @param {String} opt.background don't wait for the job to resolve (use this with care!)
 * @param {String} opt.description give it a reasonable description
 * @param {Any} options The options to be passed to the job-module
 * @returns {Promise} The 'job' promise with the job result
 */
module.exports = function ({ name, host, background, description, exclusiveId }, options, logger) {

    if(!logger){
        logger = console;
        require('console-stamp')(logger, {
            pattern: 'HH:MM:ss.l',
            metadata: `[${process.pid}]`.padEnd(8),
            colors: {
                stamp: ['blue'],
                label: ['white'],
                metadata: ['green']
            }
        });
    }

    const socket = io(`https://${ebHost}:${ebPort}/bus`, socketOptions);

    return new Promise((resolve, reject) => {
        if (!name)
            return reject('job name not defined');

        logger.log('[EB] Add Job: ', name);
        if (background) {
            console.warn(chalk.red.bold('Please use the job type \'queue\' with the \'background\' option instead for background job execution!'));
        }
        if (exclusiveId){
            console.warn(chalk.red.bold('EventBusJob (bus.run) jobs don\'t support exclusive mode! This job will not run exclusively!'));
        }
        socket.emit('run', {
            name,
            host,
            background,
            options,
            description
        }, (error, result) => {
            socket.disconnect();

            if (error)
                return reject(error);
            return resolve(result);
        });

    });
};
