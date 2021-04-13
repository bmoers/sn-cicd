module.exports = {
    apps: [{
        name: 'server',
        script: './server.js',
        instances: 2,
        env: {
            NODE_ENV: 'production',
            CICD_EB_WORKER_CLUSTER_NUM: 0
        },
        instance_var: 'INSTANCE_ID'
    }]
};
