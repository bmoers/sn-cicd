/* eslint-disable no-lonely-if */

const xmlRegex = require('./xml-regex');
const fs = require('fs');
const convert = require('xml-js');

const toXmlSync = function (json, spaces) {
    var options = {
        spaces: spaces || 0,
        compact: true,
        textFn: function (value, currentElementName, currentElementObj) {
            return typeof currentElementObj == 'object' ? currentElementObj._text : currentElementObj;
        }
    };
    // remove the element name from the list again
    Object.keys(json).forEach((key) => {
        delete json[key].___name;
    });
    delete json.___name;
    return convert.js2xml(json, options);
};

const toXml = (json, spaces) => {
    return new Promise((resolve) => {
        resolve(toXmlSync(json, spaces));
    });
};

const parse = function ({ file, parseConfig, filterSysIds = [] }, rowCallback) {

    return new Promise((resolve, reject) => {
        parseSync({ file, parseConfig, filterSysIds }, rowCallback, resolve, reject);
    });
};

const parseSync = function ({ file, parseConfig = {}, filterSysIds = [] }, rowCallback, resolve, reject) {

    /*
        {
        'exampleGroupName': {
            fields: ['sys_id', 'sys_updated_on', 'sys_recorded_at'],//'*'
        }
    }
    */

    const filterIds = (Array.isArray(filterSysIds) && filterSysIds.length) ? filterSysIds : false;
    const updateSetFile = fs.createReadStream(file);
    const xmlStream = xmlRegex(updateSetFile, { strict: true, trim: false, normalize: false, simplifyNodes: false });

    const out = [];

    Object.keys(parseConfig).forEach((tagName) => {

        xmlStream.on(`tag:${tagName}`, (tag) => {

            const name = tag.$name;

            const parseFields = parseConfig[name].fields;
            let object = {};
            if (tag.$attrs)
                object._attributes = tag.$attrs;
            object.___name = name;

            if (tag.$markup) {

                tag.$markup.forEach((child) => {
                    if (child !== null && typeof child == 'object' && (parseFields == '*' || parseFields.includes(child.$name.toLowerCase()))) {
                        let childObject = {};

                        if (child.$attrs)
                            childObject._attributes = child.$attrs;

                        if (child.$cdata) {
                            childObject._cdata = child.$cdata;
                        } else if (child.$text) {
                            if (childObject._attributes) {
                                childObject._text = child.$text;
                            } else {
                                childObject = child.$text;
                            }
                        }
                        object[child.$name] = childObject;
                    }
                });
            } else {
                if (tag.$cdata) {
                    object._cdata = tag.$cdata;
                } else if (tag.$text) {
                    if (object._attributes) {
                        object._text = tag.$text;
                    } else {
                        object = tag.$text;
                    }
                }
            }

            const sysId = (object.sys_id == undefined) ? null : object.sys_id._text || object.sys_id;
            if (!filterIds || (sysId && filterIds.includes(sysId))) {
                if (rowCallback !== undefined) {
                    rowCallback(object);
                } else {
                    out.push(object);

                }
            }

        });

    });

    xmlStream.on('error', (err) => {
        if (reject)
            reject(err);
    });
    xmlStream.on('end', () => {
        if (resolve)
            return resolve(out);
    });


};

module.exports = {
    parse,
    parseSync,
    toXml,
    toXmlSync
};
