
module.exports = function() {
    const self = this;

    return ['application', 'us', 'run', 'step'].reduce((out, table) => {
        out[table] = {
            get: ({
                _id
            }) => {
                return self.dataStore[table].findOneAsync({
                    _id
                });
            },
            insert: (obj) => {
                return self.dataStore[table].insertAsync(obj);
            },
            update: (obj) => {
                const { _id } = obj;
                return self.dataStore[table].findOneAsync({ _id }).then((result) => {
                    if (result)
                        return self.dataStore[table].updateAsync({ _id }, obj);
                    return self.dataStore[table].insertAsync(obj);
                });
            },
            delete: ({
                _id
            }) => {
                return self.dataStore[table].removeAsync({
                    _id
                });
            },
            find: (query) => {
                return self.dataStore[table].findAsync(query);
            }
        };
        return out;
    }, {
        type: 'local'
    });
};