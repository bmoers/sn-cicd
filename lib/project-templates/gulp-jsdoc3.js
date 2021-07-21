const map = require('map-stream');
const tmp = require('tmp');
tmp.setGracefulCleanup();

const fs = require('fs');
const path = require('path');
const fancyLog = require('fancy-log');
let os = require('os').type();

let debug = require('debug')('gulp-jsdoc3');
const v8 = require('v8');
/**
 * @callback gulpDoneCallback
 */

/**
 * A wrapper around jsdoc cli.
 *
 * This function collects all filenames. Then runs:
 * ```jsdoc -c config -t node_modules/ink-docstrap/template gulpFile1 gulpFile2```
 * @example
 * gulp.src(['README.md', 'src/*.js']), {read: false}).pipe(
 *     jsdoc(options, cb)
 * );
 *
 * @param {Object} [config=require('./jsdocConfig.json')]
 * @param {gulpDoneCallback} done
 * @returns {*|SignalBinding}
 */
module.exports = function jsdoc(config, done) {
    let files = [];


    // User just passed callback
    if (arguments.length === 1 && typeof config === 'function') {
        done = config;
        config = undefined;
    }

    // Prevent some errors
    if (typeof done !== 'function') {
        done = function () {
        };
    }

    // We clone the config file so as to not affect the original
    let jsdocConfig = (config) ? v8.deserialize(v8.serialize(jsdocConfig)) : require('./jsdocConfig.json');

    const logInfo = !jsdocConfig.log ? true : jsdocConfig.log.info;
    const logError = !jsdocConfig.log ? true : jsdocConfig.log.error;

    if (!logInfo) {
        fancyLog('Quiet Mode: console.info disabled, to enable set config.log.info to true');
    }
    if (!logError) {
        fancyLog('Quiet Mode: console.error disabled, to enable set config.log.error to true');
    }

    debug('Config:\n' + JSON.stringify(jsdocConfig, undefined, 2));

    return map(function (file, callback) {
        files.push(file.path);
        callback(null, file);
    }).on('end', function () {
        // We use a promise to prevent multiple dones (normal cause error then close)
        new Promise(function (resolve, reject) {

            // If the user has specified a source.include key, we append the
            // gulp.src files to it.
            if (jsdocConfig.source && jsdocConfig.source.include) {
                // append missing files
                jsdocConfig.source.include = jsdocConfig.source.include.concat(files.filter((item) => jsdocConfig.source.include.indexOf(item) < 0));

            } else {
                jsdocConfig = Object.assign(jsdocConfig, { source: { include: files } });
            }

            if (jsdocConfig.source.include.length === 0) {
                const errMsg = 'JSDoc Error: no files found to process';
                fancyLog.error(errMsg);

                reject(new Error(errMsg));
                return;
            }

            const tmpobj = tmp.fileSync({ keep: false });

            debug('Documenting files: ' + jsdocConfig.source.include.join(' '));
            fs.writeFile(tmpobj.name, JSON.stringify(jsdocConfig), 'utf8', function (err) {
                // We couldn't write the temp file
                /* istanbul ignore next */
                if (err) {
                    reject(err);
                    return;
                }

                const spawn = require('child_process').spawn,
                    cmd = require.resolve('jsdoc/jsdoc.js'), // Needed to handle npm3 - find the binary anywhere
                    inkdocstrap = path.dirname(require.resolve('ink-docstrap'));

                let args = ['-c', tmpobj.name];

                // Config + ink-docstrap if user did not specify their own layout or template
                if (!(jsdocConfig.opts &&
                    jsdocConfig.opts.template) && !(jsdocConfig.templates &&
                        jsdocConfig.templates.default &&
                        jsdocConfig.templates.default.layoutFile)) {
                    args = args.concat(['-t', inkdocstrap]);
                }

                debug(cmd + ' ' + args.join(' '));

                const child = os === 'Windows_NT'
                    ? spawn(process.execPath, [cmd].concat(args), { cwd: process.cwd() })
                    : spawn(cmd, args, { cwd: process.cwd() }); // unix
                child.stdout.setEncoding('utf8');
                child.stderr.setEncoding('utf8');

                child.stdout.on('data', function (data) {
                    if (logInfo) {
                        fancyLog(data);
                    }
                });

                child.stderr.on('data', function (data) {
                    if (logError) {
                        fancyLog.error(data);
                    }
                });

                child.on('close', function (code) {
                    if (code === 0) {
                        fancyLog('Documented ' +
                            jsdocConfig.source.include.length + ' ' +
                            (jsdocConfig.source.include.length === 1 ? 'file!' : 'files!')
                        );
                        resolve();
                    } else {
                        fancyLog.error('JSDoc returned with error code: ' + code);
                        reject(new Error('JSDoc closed with error code: ' + code));
                    }
                });
                child.on('error', function (error) {
                    fancyLog.error('JSDoc Error: ' + error);
                    reject(new Error(error));
                });
            });
        }).then((data) => done(undefined, data)).catch((err) => done(err));
    });
}
