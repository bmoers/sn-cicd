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
module.exports = function () {

    const self = this;

    const certDir = path.join(__dirname, '../', '../', 'cert');

    const ebHost = process.env.CICD_EB_HOST_NAME || 'localhost';
    const ebPort = process.env.CICD_EB_HOST_PORT || 4443;
    const ebClientKey = process.env.CICD_EB_HOST_CLIENT_KEY || path.resolve(certDir, 'eb-client-key.pem');
    const ebClientCert = process.env.CICD_EB_HOST_CLIENT_CERT || path.resolve(certDir, 'eb-client-crt.pem');
    const ebClientCa = (process.env.CICD_EB_HOST_CLIENT_CA !== undefined) ? process.env.CICD_EB_HOST_CLIENT_CA : path.resolve(certDir, 'eb-ca-crt.pem');

    //console.log(ebClientKey, ebClientCert, ebClientCa);

    const socket = io(`https://${ebHost}:${ebPort}/db`, {
        key: fs.readFileSync(ebClientKey),
        cert: fs.readFileSync(ebClientCert),
        ca: (ebClientCa) ? fs.readFileSync(ebClientCa) : null
    }).binary(false);

    const op = function (table, operation, arg) {
        return new Promise((resolve, reject) => {
            
            //console.log('[DB] emit', table, operation); // arg
            //console.dir(options, { depth: null, colors: true });

            socket.emit('op', {
                table: table,
                operation: operation,
                arguments: arg
            }, (error, result) => {
                //socket.disconnect();
                if (error)
                    return reject(error);
                return resolve(result);
            });

        });
    };

    return ['application', 'us', 'run', 'step'].reduce((out, table) => {
        out[table] = ['get', 'insert', 'update', 'delete', 'find', 'findOne'].reduce((type, operation) => {
            type[operation] = function (ob) {
                return op(table, operation, ob);
            };
            return type;
        }, {});
        return out;
    }, {type:'socket'});

};