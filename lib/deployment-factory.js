

const EbQueueJob = require('./eb/queue-job');

module.exports = async function ({ commitId, from, to, deploy, git }, logger = console, { host }) {



    return new EbQueueJob({ name: 'deploy', background: true, description: 'Deploy UpdateSet ' }, { commitId, from, to, deploy, git }).then((result) => {
        return res.json({
            run: 'added-to-queue',
            result,
            status: `/run/${result.id}`
        });
    });

    

};


