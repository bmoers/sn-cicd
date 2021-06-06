
const path = require("path");
const fs = require('fs-extra');
const streamer = require('../lib/ext/us-streamer');
const parseConfig = {
    'sys_update_xml': {
        fields: ['sys_id', 'sys_updated_on', 'sys_recorded_at', 'name', 'action', 'payload']
    }
};

return streamer.parse({
    file: path.resolve('sys_update_set_5d88b50a1b1f60103ce1866ee54bcb12.xml'),
    parseConfig
}).then((out) => {
    console.log(out);
})

const parseConfig = {
    'sys_update_xml': {
        fields: '*'
    }
};
