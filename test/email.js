const path = require('path');
require('dotenv').config({
    path: path.resolve(__dirname, 'mocha', '.env')
});
require('dotenv').config();

process.env.TESTING = 'true';

var CICD = require('../lib/cicd');

var cicd = new CICD();

cicd.self.email.onBuildFailure({
    recipient: process.env.TEST_EMAIL_TO,
    cc: process.env.TEST_EMAIL_CC,
    subject: 'Test Mail',
    data: {
        sequence: 1,
        sourceUpdateSetName: 'sourceUpdateSetName',
        sourceUpdateSetID: 'sourceUpdateSetID',
        sourceUpdateSetUrl: 'sourceUpdateSetUrl',
        docUri: 'docUri'
    }
});
