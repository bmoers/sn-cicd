const Promise = require('bluebird');
const path = require("path");



module.exports = function (ctx) {
    const self = this;
    const config = ctx.config;
    let project;

    const step = (message, error) => {
        return self.addStep(config, `${path.basename(__filename).split('.')[0]} : ${message}`, error);
    };

    return Promise.try(() => {
        ctx.project = project = self.getProject(config);
    }).then(() => {

        return step('install node application').then(() => {
            return project.install();
        }).then((result) => {
            step(`install node application completed\n${result.log}`);
        }).catch((error) => {
             step(`install node application failed: \n${error.log}`, new Error(error.log));
             throw Error(error.log);
        });

    }).then(() => {

        return step('build project').then(() => {
            return project.build();
        }).then((result) => {
            step(`build project completed: \n${result.log}`);
        }).catch((error) => {
            step(`build project failed: \n${error.log}`, new Error(error.log));
            throw Error(error.log);
        });
        
    });

};