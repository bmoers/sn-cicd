/* eslint-disable no-process-exit */


process.env.CICD_EB_WORKER_CLUSTER_NUM = 0;
const Promise = require('bluebird');
const CICD = require('./lib/cicd');

(async () => {
    try {

        const cicd = new CICD();

        await cicd.start()
        console.log('-----------------------------------------------');
        console.log('Server Started');

        await cicd.worker();
        console.log('-----------------------------------------------');
        console.log('Worker Started');

        await Promise.delay(5000);

        console.error('Server startup OK, exit.');
        process.exit(0);
    } catch (e) {
        console.error('Server startup failed', e);
        process.exit(1);
    }

})();


