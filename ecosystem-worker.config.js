module.exports = {
    apps: [{
        name: "worker",
        script: "./worker.js",
        instances: "max",
        env: {
            NODE_ENV: "production",
            CICD_EB_WORKER_CLUSTER_NUM: 0
        },
        instance_var: 'INSTANCE_ID'
    }]
}
