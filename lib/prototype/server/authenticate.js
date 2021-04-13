
module.exports = (token) => {
    return function (req, res, next) {
        if(!req || !res || !token)
            throw Error('Unauthorized');
    
        var requestToken = req.headers['x-access-token'];
        if (!requestToken)
            return res.status(401).send({
                message: 'Unauthorized'
            });
        if (token !== requestToken)
            return res.status(500).send({
                message: 'Failed to authenticate. Invalid \'x-access-token\' value.'
            });
    
        return next();
    };
};
