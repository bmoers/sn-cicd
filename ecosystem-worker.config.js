/*
This ecosystem file will start as many worker nodes as CPU available.

CICD_BUILD_NODE_OPTIONS: 
    - the params used by the spawn process to run 'gulp'

CICD_BUILD_STEP_NODE_OPTIONS: 
    - the params used by the JsDoc process inside of 'gulp', if not defined, the value is taken from CICD_BUILD_NODE_OPTIONS
*/

const workerConfig = {
    name: 'worker',
    script: './worker.js',
    instances: 'max',
    env: {
        NODE_ENV: 'production',
        CICD_EB_WORKER_CLUSTER_NUM: 0,
        CICD_BUILD_NODE_OPTIONS: '--max-old-space-size=2048',
        CICD_BUILD_STEP_NODE_OPTIONS: '--max-old-space-size=1536',
        _DEBUG: '*'
    },
    instance_var: 'INSTANCE_ID',
    node_args: '--max-old-space-size=2048'
};

module.exports = {
    apps: [workerConfig]
};
