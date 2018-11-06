module.exports = {
    apps: [{
        name: "server",
        script: "./server.js",
        env: {
            NODE_ENV: "production"
        }
    },
    {
        name: "worker",
        script: "./worker.js",
        instances: "max",
        env: {
            NODE_ENV: "production"
        }
    }]
}