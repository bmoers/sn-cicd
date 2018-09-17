
const processFiles = require('./process-files');

/**
 * group and process all files by className
 * 
 * @param {Array} applicationFiles {sys_id, u_file_class, u_file}
 * @returns {Promise}
 */
var processFilesByClass = function (ctx, applicationFiles) {

    applicationFiles = applicationFiles || [];
    /*
        sort applicationFiles by className
        this allows us to reduce the calls to one per class/table name
        { classNameX : [sysId,sysId], classNameY : [sysId,sysId] }
    */
    console.log("Process files by class");
    return Promise.reduce(applicationFiles, (applicationFilesByClass, file) => {
        var className = file.className;
        if (applicationFilesByClass[className] === undefined)
            applicationFilesByClass[className] = [];

        applicationFilesByClass[className].push(file);
        return applicationFilesByClass;

    }, {}).then((applicationFilesByClass) => {

        var filesOnDisk = [];
        // callback per chunk
        return Promise.each(Object.keys(applicationFilesByClass), (className) => {
            console.log("\t", className);
            return processFiles(ctx, className, applicationFilesByClass[className]).then((filesUpdated) => {
                filesOnDisk = filesOnDisk.concat(filesUpdated);
            });
        }).then(() => {
            return filesOnDisk;
        });
    });
};
module.exports = processFilesByClass;