const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, 'mocha', '.env') });
require('dotenv').config();

const Promise = require('bluebird');


const getTransporter = function () {
    const nodemailer = require('nodemailer');

    const options = {
        host: process.env.CICD_EMAIL_HOST,
        port: process.env.CICD_EMAIL_PORT,
        secure: Boolean(process.env.CICD_EMAIL_SECURE === 'true'),
        tls: {
            rejectUnauthorized: false
        }
    };
    if (process.env.NODE_EXTRA_CA_CERTS) {
        options.tls = {
            ca: fs.readFileSync(process.env.NODE_EXTRA_CA_CERTS, 'UTF8')
        };
    }

    if (process.env.CICD_EMAIL_USER_NAME) {
        options.auth = {
            user: process.env.CICD_EMAIL_USER_NAME,
            pass: process.env.CICD_EMAIL_USER_PASSWORD
        };
    }

    return nodemailer.createTransport(options);
};

const text = function (recipient, subject, message) {

    console.log('Send email ', recipient, subject, message);

    return Promise.try(() => {
        if (process.env.CICD_EMAIL_ENABLED !== 'true') {
            console.warn('Email notification is disabled. Following message was not sent:', recipient, subject, message);
            return;
        }
        return getTransporter().sendMail({
            from: process.env.CICD_EMAIL_FROM,
            to: recipient,
            subject: subject,
            html: message
        }).catch((e) => {
            console.error('Email notification error:', e);
        });
    });
};

text(process.env.TEST_MAIL_TO, `This is a test email to ${process.env.TEST_MAIL_TO}`, 'message').then((s) => {
    console.log(s);
}).catch((e) => {
    console.error(e);
});
