var Promise = require('bluebird'),
    rp = require('request-promise'),
    assign = require('object-assign-deep'),
    htmlEntities = require('html-entities').AllHtmlEntities;

/**
 * 
 * 
 * @param {any} defaults.active Slack enabled
 * @param {any} defaults.webhookUri the Slack Webhook-URL
 * @param {any} defaults.channel an alternative channel to be used
 * @param {any} defaults.target.project the default GIT project name
 * @param {any} defaults.target.repository the default GIT repository name
 * @param {any} defaults.target.branch the default GIT branch name
 * @returns {Slack}
 */
module.exports = function (defaults) {

    var properties = {
        active: true,
        webhookUri: null,
        channel: null,
        target: {
            project: null, //"SNOW",
            repository: null, //"update-set",
            branch: 'master'
        }
    };
    if (typeof defaults === 'string') {
        properties.webhookUri = defaults;
    } else {
        assign(properties, defaults);
    }

    var OPEN = 1,
        DECLINE = 2,
        MERGE = 3,
        DELETE = 4,
        APPROVE = 5;

    var active = (properties.webhookUri) ? properties.active : false;
    
    var rpd = rp.defaults({
        json: true,
        uri: properties.webhookUri,
        gzip: true,
        strictSSL: false,
        proxy: process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy,
        encoding: "utf8"
    });
    /*
    console.log({
        json: true,
        uri: properties.webhookUri,
        gzip: true,
        strictSSL: false,
        proxy: process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy,
        encoding: "utf8"
    });
    */
    var configure = function (config) { 
        return assign({
            request: {
                id: null,
                name: null,
                url: null,
            },
            author: {
                id: null,
                name: null,
                displayName: null,
                icon: null,
            },
            reviewers: [{
                id: null,
                name: null,
                displayName: null,
                icon: null,
            }
            ],
            source: {
                project: null,
                repository: null,
                branch: null,
            },
            target: {
                project: null,
                repository: null,
                branch: null,
            },
            comment: null
        }, config);
    };

    var comment = function (config) { 
        var options = configure(config);

        if (!options.comment)
            return;
        
        var body = {
            channel: properties.channel,
            mrkdwn: true,
            link_names: true,
            parse: 'none',
            attachments: [{
                mrkdwn_in: [
                    'pretext', 'text', 'title', 'fields', 'fallback'
                ],
                fields: [{
                    title: 'Comment',
                    value: htmlEntities.decode(options.comment.replace(/<br\s*\/>/gi,'\n')),
                    short: false
                }],
                fallback: `${options.author.name} commented on "${options.request.name}". <${options.request.url}|(${options.actionText})>`,
                //color: '#e6e6e6',
                text: `commented on <${options.request.url}|#${options.request.id}: ${options.request.name}>`,
                author_name: options.author.name,
                author_icon: options.author.icon
            }],
            username: '',
            icon_url: '',
            icon_emoji: ''
        };
        return send(body);
    };

    var pull = function (action, config) {

        var options = configure(config);
        
        options.action = action; //['opened', 'declined', 'merged', 'deleted']
        options.actionText = options.action == APPROVE ? 'approved' : options.action == DELETE ? 'deleted' : options.action == OPEN ? 'opened' : options.action == DECLINE ? 'declined' : options.action == MERGE ? 'merged' : '';
        options.color = options.action == APPROVE ? '#14892c' : options.action == DELETE ? '#FF0000' : options.action == OPEN ? '#2267c4' : options.action == DECLINE ? '#990016' : options.action == MERGE ? '#1e8217' : '#FFCC00';

        // set the target from default if not specified
        if (properties.target && properties.target.project && properties.target.repository && properties.target.branch)
            options.target = properties.target;
        
        // set source form target if not specified
        if (!options.source.project)
            options.source.project = options.target.project;
        if (!options.source.repository)
            options.source.repository = options.target.repository;


        
        var body = {
            channel: properties.channel,
            mrkdwn: true,
            link_names: true,
            parse: 'none',
            attachments: [{
                mrkdwn_in: [
                    'pretext', 'text', 'title', 'fields', 'fallback'
                ],
                fields: [{
                        title: 'Reviewers',
                        value: options.reviewers.map(function (reviewer) {
                            var text = reviewer.id || reviewer.displayName || reviewer.name || 'no-reviewer!';
                            return reviewer.id ? `<@${text}>` : `@${text}`;
                        }).join(', '),
                        short: false
                    },
                    {
                        title: 'Source',
                        value: `_${options.source.project} — ${options.source.repository}_\n\`${options.source.branch}\``,
                        short: true
                    },
                    {
                        title: 'Destination',
                        value: `_${options.target.project} — ${options.target.repository}_\n\`${options.target.branch}\``,
                        short: true
                    }
                ],
                fallback: `${options.author.name} ${options.actionText} pull request "${options.request.name}". <${options.request.url}|(${options.actionText})>`,
                color: options.color,
                text: `${options.actionText} pull request <${options.request.url}|#${options.request.id}: ${options.request.name}>`,
                author_name: options.author.name,
                author_icon: options.author.icon
            }],
            username: '',
            icon_url: '',
            icon_emoji: ''
        };

        return send(body);
    };

    var send = function (body) {
        return Promise.try(function () {
            if (active){
                return rpd({
                    method: 'post',
                    body: body
                });
            }
            console.log("Slack not active. Message: %j", body);
        });
        
    };

    var build = function (color, user, message) {
        var body = {
            channel: properties.channel,
            mrkdwn: true,
            link_names: true,
            parse: 'none',
            attachments: [{
                mrkdwn_in: [
                    'pretext', 'text', 'title', 'fields', 'fallback'
                ],
                fallback: message,
                color: color,
                text: message,
                author_name: user,
                author_icon: null
            }],
            username: '',
            icon_url: '',
            icon_emoji: ''
        };
        return send(body);
    };

    return {
        pullRequest: {

            open: function (config) {
                //console.log('OPEN', config)
                return pull(OPEN, config);
            },
            decline: function (config) {
                //console.log('DECLINE', config)
                return pull(DECLINE, config);
            },
            merge: function (config) {
                //console.log('MERGE', config)
                return pull(MERGE, config);
            },
            delete: function (config) {
                //console.log('DELETE', config)
                return pull(DELETE, config);
            },
            approve: function (config) {
                //console.log('APPROVE', config)
                return pull(APPROVE, config);
            },
            comment: function (config) {
                //console.log('Comment', config)
                return comment(config);
            },
            send: function (config) {
                var app = this;
                return Promise.try(function () {
                    var action = (config.action || '').toLowerCase();
                    if (action.includes('open'))
                        return app.open(config);

                    if (action.includes('decline'))
                        return app.decline(config);

                    if (action.includes('merge'))
                        return app.merge(config);

                    if (action.includes('delete'))
                        return app.delete(config);
                    
                    if (action.includes('approved'))
                        return app.approve(config);
                    
                    if (action.includes('comment'))
                        return app.comment(config);
                    //return pull(-1, config);
                });
            }
        },
        build: {
            start: function (text, user) {
                return build('#2267c4', user, text);  
            },
            complete: function (text, user) {
                return build('#1e8217', user, text);
            },
            failed: function (text, user) {
                return build('#990016', user, text);
            }
        },
        message: function (text, icon) {
            return send({
                channel: properties.channel,
                text: text,
                icon: icon || null,
                mrkdwn: true
            });
        }
    };
};