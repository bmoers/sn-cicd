module.exports = {
    apps: [{
        name: 'server',
        script: './server.js',
        env: {
            NODE_ENV: 'production',
            CICD_EB_WORKER_CLUSTER_NUM: 0,
            NODE_EXTRA_CA_CERTS: '/etc/ssl/ca-bundle.pem'
        },
        instance_var: 'INSTANCE_ID'
    }, {
        name: 'worker',
        script: './worker.js',
        instances: 'max',
        env: {
            NODE_ENV: 'production',
            CICD_EB_WORKER_CLUSTER_NUM: 0,
            NODE_EXTRA_CA_CERTS: '/etc/ssl/ca-bundle.pem'
        },
        instance_var: 'INSTANCE_ID'
    }]
};
