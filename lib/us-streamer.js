const Parser = require('node-xml-stream-parser');
const fs = require('fs');
const assign = require('object-assign-deep');

const toXml = function (json) {
    return new Promise((resolve, reject) => { 
        var convert = require('xml-js');
        var options = {
            //spaces: '\t',
            compact: true,
            textFn: function (value, currentElementName, currentElementObj) {
                if ('payload' != currentElementName)
                    return value;

                return value.replace(/&amp;quot;/g, '&quot;')  // convert quote back before converting amp
                    .replace(/&amp;amp;/g, '&amp;')
                    .replace(/&amp;lt;/g, '&lt;')
                    .replace(/&amp;gt;/g, '&gt;')
                    .replace(/&amp;quot;/g, '&quot;')
                    .replace(/&amp;apos;/g, '&apos;');
            }
        };
        resolve(convert.js2xml(json , options));
    });
};

const parse = function ({ file, parseConfig, filterSysIds = []}){

    const parseStructure = assign({
        'exampleGroupName': {
            fields: ['sys_id', 'sys_updated_on', 'sys_recorded_at'],//'*',
            name: 'getRecordsResult'
        }
    }, parseConfig || {});

    const filterIds = (Array.isArray(filterSysIds) && filterSysIds.length) ? filterSysIds : false;

    return new Promise((resolve, reject) => {

        const parser = new Parser();
        const out = [];

        let parseFields = null;
        let object = {}
        let field = null;

        parser.on('opentag', (name, attrs) => {
            if (parseStructure[name]) {
                //console.log('open tag', name);
                parseFields = parseStructure[name].fields;
                object['_attributes'] = attrs;
            }
            if (parseFields && (parseFields.includes(name) || '*' == parseFields)) {
                field = name
            } else {
                field = null;
            }
        });

        // </tag>
        parser.on('closetag', name => {
            if (parseStructure[name]) {
                //console.log('close tag', name, object);
                parseFields = null;
                if (!filterIds || (filterIds.includes(object.sys_id))) {
                    /*
                    if (parseStructure[name].name) {
                        out.push({ [parseStructure[name].name]: { ...object } });
                    } else {
                        out.push({ ...object });
                    }
                    */
                    out.push({ ...object });
                }
                object = {}
            }
            field = null;
        });

        // <tag>TEXT</tag>
        parser.on('text', text => {
            // text = 'TEXT'
            if (field && !object[field]) {
                object[field] = text;
            }

        });

        // <[[CDATA['data']]>
        parser.on('cdata', cdata => {
            // cdata = 'data'
            if (field) {
                object[field] = { "_cdata": cdata };
            }
        });
        /*
        // <?xml version="1.0"?>
        parser.on('instruction', (name, attrs) => {
            // name = 'xml'
            // attrs = { version: '1.0' }
        });
        */
        // Only stream-errors are emitted.
        parser.on('error', (err) => {
            // Handle a parsing error
            reject(err);
        });

        parser.on('finish', () => {
            // Stream is completed
            //console.log('%j', out);
            resolve(out);
        });

        // Pipe a stream to the parser
        let stream = fs.createReadStream(file);
        stream.pipe(parser);
    });
    
};

module.exports = {
    parse,
    toXml
};
