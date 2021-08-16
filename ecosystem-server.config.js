/*
This ecosystem file will start the server PLUS 4 worker nodes.

CICD_BUILD_NODE_OPTIONS: 
    - the params used by the spawn process to run 'gulp'

CICD_BUILD_STEP_NODE_OPTIONS: 
    - the params used by the JsDoc process inside of 'gulp', if not defined, the value is taken from CICD_BUILD_NODE_OPTIONS
*/

const gracefulShutdownTimeoutMinutes = 20;
const killTimeout = gracefulShutdownTimeoutMinutes * 60 * 1000;

const serverConfig = {
    name: 'server',
    script: './server.js',
    kill_timeout: killTimeout,
    wait_ready: true,
    listen_timeout: 60 * 1000,
    env: {
        KUBERNETES_SERVICE_HOST: 'http://localhost:8080',
        CICD_K8S_LIVENESS_PORT: 9001,
        CICD_GRACEFUL_SHUTDOWN_TIMEOUT_MINUTES: gracefulShutdownTimeoutMinutes,
        NODE_ENV: 'production',
        CICD_EB_WORKER_CLUSTER_NUM: 0,
        CICD_BUILD_NODE_OPTIONS: '--max-old-space-size=2048',
        CICD_BUILD_STEP_NODE_OPTIONS: '--max-old-space-size=1536',
        _DEBUG: '*'
    },
    instance_var: 'INSTANCE_ID',
    node_args: '--max-old-space-size=4096'
};

const [workerConfig] = require('./ecosystem-worker.config.js').apps;

module.exports = {
    apps: [
        serverConfig,
        // shallow clone the object to not modify the 'required' object in memory
        Object.assign({}, workerConfig, {
            instances: 4,
            kill_timeout: killTimeout,
            wait_ready: true,
            listen_timeout: 60 * 1000,
            env: {
                CICD_GRACEFUL_SHUTDOWN_TIMEOUT_MINUTES: gracefulShutdownTimeoutMinutes,
            }
        })
    ]
};
