
var CICD = require('./lib/cicd');

var cicd = new CICD('server-options.json');
cicd.server();