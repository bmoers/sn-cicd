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
            //console.log('[DB] EMIT-OP', table, operation, arg);
            socket.emit('op', {
                table: table,
                operation: operation,
                arguments: arg
            }, (error, result) => {
                if (error)
                    return reject(error);
                return resolve(result);
            });

        });
    };

    const registerDataStore = function (name) {
        return new Promise((resolve, reject) => {
            socket.emit('register', name, (error, result) => {
                if (error)
                    return reject(error);
                return resolve(result);
            });
        });
    };

    const getOperations = (table, operations = ['get', 'insert', 'update', 'delete', 'find', 'findOne']) => {
        return operations.reduce((type, operation) => {
            type[operation] = function (...arg) {
                return op(table, operation, arg);
            };
            return type;
        }, {});
    };
    const addDataSource = (table) => {
        dataStore[table] = getOperations(table);
    }

    const dataStore = {
        type: 'socket',
        registerDataStore: (name) => {
            return registerDataStore(name).then((result) => {
                //console.log("registerDataStore [socket]", result);
                dataStore[name] = getOperations(name, result);
                return result;
            });
        }
    };

    Object.keys(self.dataStore).forEach((table) => {
        addDataSource(table);
    });

    return dataStore;

};