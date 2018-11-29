const Promise = require('bluebird');

const etparse = require('elementtree').parse;

let payload = `<?xml version="1.0" encoding="UTF-8"?><record_update table="sys_atf_test_suite_test"><sys_atf_test_suite_test action="INSERT_OR_UPDATE"><abort_on_failure /><order attr="value " /><sys_class_name>sys_atf_test_suite_test</sys_class_name></sys_atf_test_suite_test></record_update>`;

payload = payload.replace(/<([^\/>]*)\/>/g, `<$1 xsi:nil="true"/>`).replace(/<([^\s\/>]*)[^>]*><\/(\1)>/g, `<$1 xsi:nil="true"/>`);
console.log(payload);
Promise.try(() => { // parse the XML payload
    return etparse(payload);
}).then((xmlTree) => { // find all tables, action and sysId in the payload
    return Promise.each(xmlTree.findall('.//*[@action]'), (element) => { 
        console.log(element.find('abort_on_failure'))
        console.log(element.find('order'))
    });

});