
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

    logger.log(' params : %j', params);
    logger.log(' job : %j', job);
    
    await Promise.delay(2 * 1000);
    
    logger.log('------ Dummy Job DONE ---------');

    //throw new Error('Pang!');

    return 'completed ' + params.body;
};
