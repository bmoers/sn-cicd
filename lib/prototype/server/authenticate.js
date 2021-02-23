
module.exports = function (req, res, next) {
    if(!req || !res)
        throw Error('Unauthorized');

    var token = req.headers['x-access-token'];
    if (!token)
        return res.status(401).send({
            message: 'Unauthorized'
        });
    if (process.env.CICD_BUILD_ACCESS_TOKEN !== token)
        return res.status(500).send({
            message: 'Failed to authenticate.'
        });

    return next();
}
