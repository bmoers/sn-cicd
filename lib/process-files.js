/**
 * 
 * 
 * @param {String} className 
 * @param {Array} sysIds 
 * @returns {Promise}
 */
var processFiles = function (ctx, className, applicationFiles) {
    var project = ctx.source,
        client = ctx.remote;

    return Promise.try(() => {

        // get the request params for this entity className
        return project.getEntityRequestParam(className);

    }).then((entityRequestParam) => {

        var fileSysIds = applicationFiles.map((file) => {
            return file.sysId;
        });
        var hasQuery = (entityRequestParam.queryFieldNames.length),
            query = `sys_idIN${fileSysIds.join(',')}`;

        if (hasQuery) {
            var entity = project.getEntity(className);

            query = entity.query.split('^NQ').map((segment) => {
                return `sys_idIN${fileSysIds.join(',')}^${segment}`;
            }).join('^NQ');
        }

        /* configure the request parameter
            !! assuming the number of sys_id per class is not more then e.g. 50
        */
        return {
            tableName: entityRequestParam.className,
            options: {
                qs: {
                    sysparm_query: query,
                    sysparm_display_value: 'all', //entityRequestParam.displayValue || false,
                    active: true,
                    sysparm_fields: entityRequestParam.fieldNames.map(function (field) {
                        return field.name;
                    }).join(',') || null
                }
            }
        };
    }).then((requestParam) => {
        var filesOnDisk = [];

        return client.getFilesFromTable(requestParam, (files) => {

            // parse and save file to disk
            return Promise.each(files, (file) => {

                // in case the file has no sys_class_name parameter (like 'sys_update_set'), add the tableName as it
                //file.sys_class_name = className;
                var appName = 'Global',
                    scopeName = 'global',
                    updatedBy = 'system';

                var appNameObj = file['sys_scope.name'] || appName;
                appName = appNameObj.display_value || appNameObj.value || appNameObj;

                var scopeNameObj = file['sys_scope.scope'] || scopeName;
                scopeName = scopeNameObj.display_value || scopeNameObj.value || scopeNameObj;

                var updatedByField = file.sys_updated_by || file.sys_created_by || updatedBy;
                updatedBy = updatedByField.display_value || updatedByField.value || updatedByField;

                /*
                    TODO:
                    - check if the file in the fileList has an update_on value older than the real one.
                        this indicates that the record was modified in the default update set.

                */
                // simulate a change on master 
                //file.sys_created_by = 'WHAHAHAHHHHAHHHHHHHAAA!';

                file.____ = {
                    hostName: client.getHostName(),
                    className: className,
                    appName: appName,
                    scopeName: scopeName,
                    updatedBy: updatedBy,
                    src: undefined
                };

                //if ('sys_ui_policy' == file.sys_class_name)
                return project.save(file).then((filesUpdated) => {
                    filesOnDisk = filesOnDisk.concat(filesUpdated);
                });

            });

        }).then(() => {
            return filesOnDisk;
        });
    });

};

module.exports = processFiles;