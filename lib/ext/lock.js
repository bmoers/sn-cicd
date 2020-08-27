/*
    mutex implementation 
    https://medium.com/trabe/synchronize-cache-updates-in-node-js-with-a-mutex-d5b395457138

    this is not a distributed lock!
    every worker thread will have its own lock, therefore it only makes sense to use
    this on the master process.

    Options to have this distributed:
        - https://github.com/boltsource/microlock
        - or even a custom implementation with https://github.com/PaquitoSoft/memored 

    below code from
    https://gist.github.com/davidbarral/59d12a20b3ae3bedd911e4ff4db798eb#file-lock-js
*/

const EventEmitter = require('events').EventEmitter;

const lock = () => {
    
    let locked = {};
    const ee = new EventEmitter();
    ee.setMaxListeners(0);

    return {
        acquire: key =>
            new Promise(resolve => {
                //console.log("acquire key", key)
                if (!locked[key]) {
                    locked[key] = true;
                    return resolve();
                }

                const tryAcquire = value => {
                    if (!locked[key]) {
                        locked[key] = true;
                        ee.removeListener(key, tryAcquire);
                        return resolve(value);
                    }
                };

                ee.on(key, tryAcquire);
            }),

        // If we pass a value, on release this value
        // will be propagated to all the code that's waiting for
        // the lock to release
        release: (key, value) => {
            //console.log("release key", key)
            Reflect.deleteProperty(locked, key);
            setImmediate(() => ee.emit(key, value));
        },
    };
};

module.exports = lock;
