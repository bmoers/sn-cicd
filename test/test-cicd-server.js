
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, 'mocha', '.env') });
require('dotenv').config();

var CICD = require('../lib/cicd');

var cicd = new CICD();
cicd.start();
