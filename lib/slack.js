const Promise = require('bluebird');
const rp = require('request-promise');
const assign = require('object-assign-deep');
const { decode } = require('html-entities');

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
        msWebhookUri: null,
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

    var active = (properties.webhookUri) ? properties.active : undefined;
    var msActive = (properties.msWebhookUri) ? properties.active : undefined;

    var rpd = rp.defaults({
        json: true,
        uri: properties.webhookUri,
        gzip: true,
        strictSSL: false,
        proxy: process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy,
        encoding: 'utf8'
    });

    var rpdMs = rp.defaults({
        json: true,
        uri: properties.msWebhookUri,
        gzip: true,
        strictSSL: false,
        proxy: process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy,
        encoding: 'utf8'
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

    const slackToMs = (text) => {
        // LINK: slack <url|text>
        text = text.replace(/<([^|>]+)\|([^>]+)>/g, '[$2]($1)');
        // NEWLine: slack: \n | teams: <br>
        text = text.replace(/\n/g, '<br>');
        // BOLD: slack: * | teams: **
        text = text.replace(/\*([^*]+)\*/g, '**$1**');

        text = text.replace(/_/g, '\\_');

        text = text.replace(/(?<!\()(http[\w:/.]*)/g, '[$1]($1)');

        return text;
    };

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
                    value: decode(options.comment.replace(/<br\s*\/>/gi, '\n')),
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

        const msBody = {
            '@type': 'MessageCard',
            '@context': 'https://schema.org/extensions',
            'summary': slackToMs(`${options.author.name} commented on "${options.request.name}". <${options.request.url}|(${options.actionText})>`),
            'title': `${options.author.name}`,
            'text': slackToMs(`commented on <${options.request.url}|#${options.request.id}: ${options.request.name}>`),
            'sections': [
                {
                    'facts': [
                        {
                            'name': 'Comment',
                            'value': slackToMs(decode(options.comment.replace(/<br\s*\/>/gi, '\n')))
                        }
                    ]
                }
            ]
        };

        return Promise.all([send(body), sendMs(msBody)]);
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

        const msBody = {
            '@type': 'MessageCard',
            '@context': 'https://schema.org/extensions',
            'summary': slackToMs(`${options.author.name} ${options.actionText} pull request "${options.request.name}". <${options.request.url}|(${options.actionText})>`),
            'themeColor': options.color,
            'title': `${options.author.name}`,
            'text': slackToMs(`${options.actionText} pull request <${options.request.url}|#${options.request.id}: ${options.request.name}>`),
            'sections': [
                {
                    'facts': [
                        {
                            'name': 'Reviewers',
                            'value': options.reviewers.map(function (reviewer) {
                                var text = reviewer.id || reviewer.displayName || reviewer.name || 'no-reviewer!';
                                return reviewer.id ? `<@${text}>` : `@${text}`;
                            }).join(', '),
                        },
                        {
                            'name': 'Source',
                            'value': `_${slackToMs(`${options.source.project} — ${options.source.repository}`)}_ <br>\`${slackToMs(options.source.branch)}\``
                        },
                        {
                            'name': 'Destination',
                            'value': `_${slackToMs(`${options.target.project} — ${options.target.repository}`)}_ <br>\`${slackToMs(options.target.branch)}\``
                        }
                    ]
                }
            ]
        };

        return Promise.all([send(body), sendMs(msBody)]);
    };

    var send = async (body) => {
        try {
            if (active) {
                await rpd({
                    method: 'post',
                    body: body
                });
            }
            if (active === false)
                console.log('Slack not active. Message: %j', body);

        } catch (e) {
            console.error('Slack Error. Message:j', e);
        }
    };

    var sendMs = async (body) => {
        try {
            if (msActive) {
                await rpdMs({
                    method: 'post',
                    body: body
                });
            }
            if (msActive === false)
                console.log('MS Teams not active. Message: %j', body);

        } catch (e) {
            console.error('MS Teams Error. Message:j', e);
        }
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

        const msBody = {
            '@type': 'MessageCard',
            '@context': 'https://schema.org/extensions',
            'summary': message,
            'themeColor': color,
            'text': slackToMs(message),
        };

        return Promise.all([send(body), sendMs(msBody)]);
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
            info: function (text, user) {
                return build('#22C453', user, text);
            },
            start: function (text, user) {
                return build('#2267c4', user, text);
            },
            complete: function (text, user) {
                return build('#1e8217', user, text);
            },
            warning: function (text, user) {
                return build('#990080', user, text);
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
