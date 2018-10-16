const express = require('express');

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
            res.json(result);
        });
    });


    const getUs = function (_id) {
        return self.db.us.get({
            _id
        }).then((us) => {
            
            if (us && us.runId) {
                return self.db.run.get({
                    _id: us.runId
                }).then((run) => {
                    if (run) {
                        us.lastRun = run;
                    }
                }).then(() => us);
            }
            return us;
        });
    }

    router.route('/app/:id/us/:us').get((req, res) => {
        return getUs(req.params.id).then((us) => res.json(us));
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
    
    return router;
};