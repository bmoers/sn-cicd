
const Promise = require('bluebird');
const puppeteer = require('puppeteer');

return puppeteer.launch({
    ignoreHTTPSErrors: true,
    headless: false,
    executablePath: process.env.CICD_ATF_BROWSER,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
}).then((browser) => {

    return browser.newPage().then((page) => {
        return page.setViewport({
            width: 1400,
            height: 1600
        }).then(() => {
            return page.goto(`http://google.com`, {
                waitUntil: 'networkidle2'
            });
        });
    });
})
