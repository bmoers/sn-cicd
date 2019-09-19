
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, 'mocha', '.env') });
require('dotenv').config();

const SnClient = require('../lib/snClient');

const snClient = new SnClient({
    hostName: process.env.M2_CICD_SOURCE,
    proxy: {
        hostName: process.env.HTTP_PROXY,
        strictSSL: false
    },

    username: process.env.CICD_CD_USER_NAME,
    password: process.env.CICD_CD_USER_PASSWORD,

    debug: false,
    silent: true,
    jar: false
});

snClient.deployUpdateSet({
    updateSetSysId: process.env.M02_CICD_TEST_US_ID,
    targetHostName: process.env.M2_CICD_DEPLOY,
    targetAuth: {
        username: process.env.CICD_CD_USER_NAME,
        password: process.env.CICD_CD_USER_PASSWORD
    },
    sourceAuth: {
        username: process.env.CICD_CD_USER_NAME,
        password: process.env.CICD_CD_USER_PASSWORD
    },
    deploy: true,
    conflictResolutions: {
        'sys_script_include_1b9ed113dbf32300fcf41780399619fc': {
            status: 'ignored',
            sysId: '1b9ed113dbf32300fcf41780399619fc',
            className: 'sys_script_include',
            updatedOn: 2567150552000
        }
    }

}).then(({ result, seconds }) => {
    console.log(`executed in ${seconds}`);
    console.log(result);
}).catch((e) => {
    if (!e.updateSet)
        throw e;

    console.log('name', e.name);
    console.log('message', e.message);
    console.log('update-set', e.updateSet);
    console.log(Object.keys(e))
    console.dir(e, { colors: true, depth: null });

});
