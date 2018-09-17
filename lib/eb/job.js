require('dotenv').config();

const fs = require('fs');
const io = require('socket.io-client');
const path = require("path");

/**
 * Add a job to the event bus queue.
 * Once the job is completed, the promise will be resolved.
 *
 * @param {String} job The name of the job-module
 * @param {*} options The options to be passed to the job-module
 * @returns {Promise} The 'job' promise with the job result
 */
module.exports = function ({ name, host }, options) {

    const certDir = path.join(__dirname, '../', '../', 'cert');

    const ebHost = process.env.CICD_EB_HOST_NAME || 'localhost';
    const ebPort = process.env.CICD_EB_HOST_PORT || 4443;
    const ebClientKey = process.env.CICD_EB_HOST_CLIENT_KEY || path.resolve(certDir, 'eb-client-key.pem');
    const ebClientCert = process.env.CICD_EB_HOST_CLIENT_CERT || path.resolve(certDir, 'eb-client-crt.pem');
    const ebClientCa = (process.env.CICD_EB_HOST_CLIENT_CA !== undefined) ? process.env.CICD_EB_HOST_CLIENT_CA : path.resolve(certDir, 'eb-ca-crt.pem');

    //console.log(ebClientKey, ebClientCert, ebClientCa);

    const socket = io(`https://${ebHost}:${ebPort}/bus`, {
        key: fs.readFileSync(ebClientKey),
        cert: fs.readFileSync(ebClientCert),
        ca: (ebClientCa) ? fs.readFileSync(ebClientCa) : null
    }).binary(false);

    return new Promise((resolve, reject) => {
        if (!name)
            return reject('job name not defined');

        console.log('[EB] Add Job: ', name);
        //console.dir(options, { depth: null, colors: true });

        socket.emit('run', {
            name: name,
            host: host,
            options: options
        }, (error, result) => {
            socket.disconnect();

            if (error)
                return reject(error);
            return resolve(result);
        });
        /*
        console.log({
            name: job,
            options: options
        });

        socket.emit('gulz', {
            name: job,
            options: null
        });
        
        console.log('asdfasdfadsf');
        socket.disconnect();
        resolve('gagaga');
        */
    });
};