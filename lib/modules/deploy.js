

const EbQueueJob = require('../eb/queue-job');

module.exports = async function ({ commitId, from, to, deploy, git }, logger = console, { host }) {


    

};

/*
return new EbQueueJob({ name: 'deploy', background: true, description: `Build UpdateSet ${options.updateSet}` }, options).then((result) => {
    return res.json({
        run: 'added-to-queue',
        result,
        status: `/run/${result.id}`
    });
});
*/
