
const Promise = require('bluebird');
const getRandomInt = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};
/**
 * Extension for CICD
 *
 * @param {*} num
 */
module.exports = async function (params, logger = console, job) {

    const self = this;

    logger.log('------ Dummy Job ---------');

    logger.log(`${job.type} :: ExclusiveId: '${job.exclusiveId}', Index: ${params.index}`);
    
    await Promise.delay(500);
    
    logger.log('------ Dummy Job DONE ---------');

    //throw new Error('Pang!');

    return `Completed: ${job.type} :: ExclusiveId: '${job.exclusiveId}', Index: ${params.index}`;
};
