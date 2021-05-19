
const Promise = require('bluebird');

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

    await Promise.delay(80 * 1000);

    return 'completedaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ' + params.body;
};
