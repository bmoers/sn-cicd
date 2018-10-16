/**
 * Extension for CICD
 *
 * @param {*} num
 */
module.exports = function (options, logger = console, { host }) {
    const self = this;

    return function (options) {
        const self = this;

        console.log('------ Example Job ---------');

        return new Promise((resolve, reject) => {
            try {
                resolve('########################## job completed ' + options.host);
            } catch (e) {
                reject(e);
            }
        });
    };
};
