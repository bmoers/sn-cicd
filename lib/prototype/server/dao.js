const express = require('express');

module.exports = function () {

    const self = this;
    const router = express.Router();

    router.route('/app').get((req, res) => {
        return self.db.application.find({}).then((result) => {
            result.sort((a, b) => {
                if (a.application.name < b.application.name) return -1;
                if (a.application.name > b.application.name) return 1;
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
            app: req.params.id
        }).then((result) => {
            result = result.map((r) => {
                if (r.config.host) {
                    delete r.config.host.credentials;
                }
                if (r.config.branch) {
                    delete r.config.branch.host.credentials;
                }
                if (r.config.deploy) {
                    delete r.config.deploy.host.credentials;
                }
                return r;
            });
            res.json(result);
        });
    });

    router.route('/app/:id/us/:us').get((req, res) => {
        return self.db.us.get({
            _id: req.params.us
        }).then((result) => {
            if (result) {
                if (result.config.host) {
                    delete result.config.host.credentials;
                }
                if (result.config.branch) {
                    delete result.config.branch.host.credentials;
                }
                if (result.config.deploy) {
                    delete result.config.deploy.host.credentials;
                }
            }
            res.json(result);
        });
    });

    router.route('/app/:id/us/:us/run').get((req, res) => {
        return self.db.run.find({
            us: req.params.us
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
            run: req.params.run
        }).then((result) => {
            result.sort((a, b) => {
                return (b.ts - a.ts);
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
            result = result.map((r) => {
                if (r.config.host) {
                    delete r.config.host.credentials;
                }
                if (r.config.branch) {
                    delete r.config.branch.host.credentials;
                }
                if (r.config.deploy) {
                    delete r.config.deploy.host.credentials;
                }
                return r;
            });
            res.json(result);
        });
    });
    router.route('/us/:id').get((req, res) => {
        return self.db.us.get({
            _id: req.params.id
        }).then((result) => {
            if (result) {
                if (result.config && result.config.host) {
                    delete result.config.host.credentials;
                }
                if (result.config && result.config.branch) {
                    delete result.config.branch.host.credentials;
                }
                if (result.config && result.config.deploy) {
                    delete result.config.deploy.host.credentials;
                }
            }
            res.json(result);
        });
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