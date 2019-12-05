const express = require('express');
const Promise = require('bluebird');

/**
 * REST API to expose DB tables.
 * Mainly used in the WEB UI.
 * 
 */
module.exports = function () {

    const self = this;
    const router = express.Router();

    router.route('/app').get((req, res) => {
        return self.db.application.find({}).then((result) => {
            result.sort((a, b) => {
                if (a.name < b.name) return -1;
                if (a.name > b.name) return 1;
                return 0;
            });
            res.json(result);
        });
    });
    router.route('/app/:id').get((req, res) => {
        return self.db.application.get({
            _id: req.params.id
        }).then((result) => {
            res.json(result);
        });
    });

    router.route('/app/:id/us').get((req, res) => {
        return self.db.us.find({
            appId: req.params.id
        }).then((result) => {
            return Promise.map(result, (us) => {
                return getUs(us._id).then((_us) => {
                    if (_us && _us.runId) {
                        us.run = {
                            config: {
                                branchName: (_us.run.config) ? _us.run.config.branchName : undefined
                            },
                            state: _us.run.state
                        }
                        us.running = _us.running;
                    }
                    return us;
                });
            })
        }).then((result) => {
            res.json(result);
        });
    });


    const getUs = function (_id) {
        return self.db.us.get({
            _id
        }).then((us) => {
            if (!us)
                return {}

            us.run = {};
            us.running = (us.running) ? 'YES' : 'No';

            if (us.runId) {
                return self.db.run.get({
                    _id: us.runId
                }).then((run) => {
                    if (run)
                        us.run = run;
                    return us;
                });
            }
            return us;
        });
    }

    router.route('/app/:id/us/:us').get((req, res) => {
        return getUs(req.params.us).then((us) => res.json(us));
    });

    router.route('/app/:id/us/:us/run').get((req, res) => {
        return self.db.run.find({
            usId: req.params.us
        }).then((result) => {
            result.sort((a, b) => {
                return (b.ts - a.ts);
            });
            res.json(result);
        });
    });

    router.route('/app/:id/us/:us/run/:run').get((req, res) => {
        return self.db.run.get({
            _id: req.params.run
        }).then((result) => {
            res.json(result);
        });
    });

    router.route('/app/:id/us/:us/run/:run/step').get((req, res) => {
        return self.db.step.find({
            runId: req.params.run
        }).then((result) => {
            result.sort((a, b) => {
                return (a.ts - b.ts);
            });
            res.json(result);
        });
    });

    router.route('/app/:id/us/:us/run/:run/step/:step').get((req, res) => {
        return self.db.step.get({
            _id: req.params.step
        }).then((result) => {
            res.json(result);
        });
    });

    router.route('/app/:id/us/:us/deployment').get((req, res) => {
        return self.db.deployment.find({
            usId: req.params.us
        }).then((result) => {
            result.sort((a, b) => {
                return (b.ts - a.ts);
            });
            res.json(result);
        });
    });

    router.route('/app/:id/us/:us/deployment/:deployment').get((req, res) => {
        return self.db.deployment.get({
            _id: req.params.deployment
        }).then((result) => {
            res.json(result);
        });
    });

    router.route('/app/:id/us/:us/test').get((req, res) => {
        return self.db.test.find({
            usId: req.params.us
        }).then((result) => {
            result.sort((a, b) => {
                return (b.ts - a.ts);
            });
            res.json(result);
        });
    });

    router.route('/app/:id/us/:us/test/:test').get((req, res) => {
        return self.db.test.get({
            _id: req.params.test
        }).then((result) => {
            res.json(result);
        });
    });

    router.route('/us').get((req, res) => {
        return self.db.us.find({}).then((result) => {
            res.json(result);
        });
    });
    router.route('/us/:id').get((req, res) => {
        return getUs(req.params.id).then((us) => res.json(us));
    });

    router.route('/run').get((req, res) => {
        return self.db.run.find({}).then((result) => {
            result.sort((a, b) => {
                return (b.ts - a.ts);
            });
            res.json(result);
        });
    });
    router.route('/run/:id').get((req, res) => {
        return self.db.run.get({
            _id: req.params.id
        }).then((result) => {
            res.json(result);
        });
    });

    router.route('/test').get((req, res) => {
        return self.db.test.find({}).then((result) => {
            res.json(result);
        });
    });
    router.route('/test/:id').get((req, res) => {
        return self.db.test.get({
            _id: req.params.id
        }).then((result) => {
            res.json(result);
        });
    });

    router.route('/deployment').get((req, res) => {
        return self.db.deployment.find({}).then((result) => {
            res.json(result);
        });
    });
    router.route('/deployment/:id').get((req, res) => {
        return self.db.deployment.get({
            _id: req.params.id
        }).then((result) => {
            res.json(result);
        });
    });

    return router;
};
