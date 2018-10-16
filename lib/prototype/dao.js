
module.exports = function() {
    const self = this;

    return ['application', 'us', 'run', 'step'].reduce((out, table) => {
        out[table] = {
            get: (obj) => {
                const { _id } = (typeof obj == 'object') ? obj : {_id: obj};
                return self.dataStore[table].findOneAsync({
                    _id
                });
            },
            insert: (obj) => {
                if (!obj)
                    throw Error('Dao. insert() : No Object specified');
                return self.dataStore[table].insertAsync(obj);
            },
            update: (obj) => {
                if (!obj)
                    throw Error('Dao. update() : No Object specified');
                const { _id } = obj;
                if (!_id)
                    throw Error('Dao. update() : No _id specified');
                
                return self.dataStore[table].findOneAsync({ _id }).then((result) => {
                    if (result)
                        return self.dataStore[table].updateAsync({ _id }, obj);
                    return self.dataStore[table].insertAsync(obj);
                });
            },
            delete: ({ _id }) => {
                if (!_id)
                    throw Error('No _id specified');
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