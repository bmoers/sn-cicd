module.exports = {
    apps: [{
        name: "server",
        script: "./server.js",
        env: {
            NODE_ENV: "production",
            CICD_EB_WORKER_CLUSTER_NUM: 0
        }
    }]
}
