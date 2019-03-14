const Promise = require('bluebird');
const path = require("path");

/**
 * Install and Build (gulp) Project
 *
 * @param {*} runId id of the current run
 * @param {Console} logger a logger to be used
 * @param {Object} job job object 
 * @returns {Promise}
 */
module.exports = function (runId, logger = console, { host }) {
    const self = this;
    let config = {};
    let project;

    const step = (message, error) => {
        return self.addStep(logger, config, `${path.basename(__filename).split('.')[0]} : ${message}`, error);
    };

    return Promise.try(() => {
        return self.db.run.get(runId).then((_run) => {
            if (!_run)
                throw Error(`Run not found with id ${runId}`);
            config = _run.config;
        });
    }).then(() => {
        return self.getProject(config).then((_project) => {
            project = _project;
        });
    }).then(() => {

        return step('install node application').then(() => {
            return project.install();
        }).then((result) => {
            return step(`install node application completed\n${result.log}`);
        }).catch((error) => {
            return step(`install node application failed: \n${error.log}`, Error(error.log)).then(() => {
                throw Error(error.log);
            });
        });

    }).then(() => {

        return step('build project').then(() => {
            return project.build();
        }).then((result) => {
            return step(`build project completed: \n${result.log}`);
        }).catch((error) => {
            return step(`build project failed: \n${error.log}`, Error(error.log)).then(() => {
                throw Error(error.log);
            });
        });
        
    }).finally(() => {
        return step('cleaning up project').then(() => { 
            return project.cleanUp();
        });
    });

};