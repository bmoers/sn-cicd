/**
 * Extension for CICD
 *
 * @param {*} num
 */
module.exports = (function () {
    

    return function (options) {
        const self = this;

        console.log('---------------------------------------------');
        self.test();
        console.log('---------------------------------------------');
        

        return new Promise((resolve, reject) => {
            try {
                //console.log("testmodule: options:", Object.keys(cicd), Object.keys(self));
                resolve('########################## job completed ' + options.host);
            } catch (e) {
                reject(e);
            }
        });
    };
})();