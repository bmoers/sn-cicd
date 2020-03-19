
//const localDao = require('./local-dao');

module.exports = function () {
    const self = this;

    if (self.db)
        return self.db;

    const dataStoreInit = Object.keys(self.dataStore).every((collection) => {
        return (self.dataStore[collection] !== null);
    });
    if ('mongo' == self.settings.dataStore.type) {
        return require('./mongo-dao').call(self);
    } else if (dataStoreInit) {
        return require('./dao').call(self);
    } else {
        return require('../eb/dao').call(self);
    }
};
