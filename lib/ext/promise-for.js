const Promise = require('bluebird');

/**
 * Loop until the condition is false
 * 
 * @async
 * @param {Promise} condition function returning true to continue looping, false to exit the loop
 * @param {Promise} action function to be called within the loop
 * @param {*} value single argument passed to the condition function
 * @returns  {Promise<*>} the last value argument which exited the loop
 * @example await promiseFor(({ proceed }) => proceed, ({ data }) => (data == 0) ? { proceed: true, data: 1 } : { proceed: false, data: 1 }, { proceed: true, data: 0 })
 */
const promiseFor = Promise.method((condition, action, value) => {
    if (!condition(value))
        return value;
    return action(value).then(promiseFor.bind(null, condition, action));
});


module.exports = promiseFor;
