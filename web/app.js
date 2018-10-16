var app = function () {

    var ROUTE = '/dao';

    var parse = function (hash) {
        var regex = /\/app(?:\/([^\/]+))?(?:\/us)?(?:\/([^\/]+))?(?:\/run)?(?:\/([^\/]+))?(?:\/step)?/gi;
        var m = regex.exec(hash);

        return {
            app: m ? m[1] : null,
            us: m ? m[2] : null,
            run: m ? m[3] : null
        };
    };

    var getHeader = function (config) {
        var header = ['<thead>', '<tr>'];

        $.each(config, function (index, value) {
            header.push('<th>' + value.name + '</th>');
        });
        header.push('</tr>', '</thead>');
        return header;
    };

    var getColumn = function (data, meta, tdOptions) {
        var html = [],
            display = [],
            uri = [],
            target = '';

        var value = getFieldValue(data, meta);
        var link = meta.link;
        if (link && link.uri.length) {

            target = (link.target) ? ' target="' + link.target + '"' : '';

            $.each(link.uri, function (i, segment) {
                uri.push(getFieldValue(data, segment));
                /*
                if (typeof segment == 'string') {
                    uri.push(segment);
                } else {
                    uri.push(getFieldValue(data, segment));
                }*/
            });
            uri = uri.join('');
        }

        if (meta.style) {
            var style = [];
            if (meta.style.match)
                style.push(meta.style[(value == meta.style.match)]);
            if (meta.style.always)
                style.push(meta.style.always);
            display.push('style="' + style.join('; ') + '"');
        }
        if (meta.class) {
            display.push('class="' + meta.class[(value == meta.class.match)] + '"');
        }
        $.each(Object.keys(tdOptions || {}), function (i, key) {
            display.push(key + '="' + tdOptions[key] + '"');
        });
        html.push('<td ' + display.join(' ') + '>');

        if (link) {
            html.push('<a href="' + uri + '"' + target + '">' + value + '</a>');
        } else {
            html.push(value);
        }
        html.push('</td>');
        return html.join('');
    };

    var getFieldValue = function (data, meta) {

        var val = (function () {
            // in case the field is no object but just a value
            if (typeof meta == 'string')
                return meta;

            var field = meta.field,
                text = meta.text,
                encode = meta.encode;

            if (text) {
                return text;
            }

            var fieldArray = (field || '').split('.');
            var element = data;
            $.each(fieldArray, function (i, field) {
                if (element && field in element) {
                    element = element[field];
                } else {
                    element = null;
                }
            });
            if (element !== null) {
                if (typeof element == 'object') {
                    element = Object.keys(element).reduce(function (prev, e) {
                        return prev += ' <b>' + e + '</b> : ' + element[e];
                    }, '');
                }
                if ('ts' == field || meta.type == 'ts')
                    return new Date(element).toLocaleString();
                if (encode && encode in window)
                    element = window[encode](element);
            }
            return element;
        })();

        if (typeof val === 'string')
            return val.replace(/\n/g, '<br />');

        return val;

    };


    var renderList = function ($target, config, data) {
        if (!data || data.length === 0)
            return;

        var html = getHeader(config);
        html.push('<tbody>');

        $.each(data, function (index, row) {
            html.push('<tr>');
            $.each(config, function (colIndex, value) {


                html.push(getColumn(row, value));
                /*

                var element = getFieldValue(row, value);
                var link = getLink(row, value);
                if (link) {
                    html.push('<td><a href="' + link.uri +'"' + link.target + '">' + element + '</a></td>');
                } else {
                    html.push('<td>' + element + '</td>');
                }
                */
            });
            html.push('</tr>');
        });
        html.push('</tbody>', '</table>');
        $('table', $target).html(html.join(''));
        $target.show();
    };

    var renderDetails = function ($target, config, data) {
        if (!data || Object.keys(data).length === 0)
            return;

        var html = [];
        $.each(config, function (i, tr) {
            html.push('<tr>');
            var colspan = tr.length == 1 ? 3 : 1;
            var width = (colspan == 1) ? 'width: ' + (100 / tr.length / 2) + '%' : '';

            $.each(tr, function (j, td) {
                html.push('<td style="' + width + '"><b>', td.name || '', '</b></td>');

                td.style = {
                    always: width
                };
                html.push(getColumn(data, td, {
                    colspan: colspan
                }));

            });
            html.push('</tr>');
        });
        $('table', $target).html(html.join(''));
        $target.show();
    };

    var getApplication = function (param, $target) {

        $.ajax({
            dataType: 'json',
            url: ROUTE + '/app/' + param.app
        }).done(function (data) {
            var config = [
                [{
                    name: 'Name',
                    field: 'name',
                    link: {
                        uri: ['/us#/app/', {
                            field: '_id'
                        }]
                    }
                },
                {
                    name: 'Repo',
                    field: 'git.repository',
                    link: {
                        uri: [{
                            field: 'git.url'
                        }],
                        target: '_blank'
                    }
                }
                ]
            ];
            renderDetails($target, config, data);
        });
    };

    var getUpdateSet = function (param, $target, layout) {

        $.ajax({
            dataType: 'json',
            url: ROUTE + '/us/' + param.us
        }).done(function (data) {
            var config = layout || [
                [{
                    name: 'Name',
                    field: 'name',
                    link: {
                        uri: ['/runs#/app/', {
                            field: 'appId'
                        }, '/us/', {
                            field: '_id'
                        }]
                    }
                },
                {
                    name: 'UpdatedBy',
                    field: 'updateSet.sys_updated_by'
                }
                ],
                [{
                    name: 'Description',
                    field: 'updateSet.description'
                }],
                [{
                    name: 'Branch',
                    field: 'lastSuccessfulRun.config.branchName',
                    link: {
                        uri: [{
                            field: 'lastSuccessfulRun.config.git.url'
                        }, '/browse?at=refs%2Fheads%2F', {
                            field: 'lastSuccessfulRun.config.branchName',
                            encode: 'encodeURIComponent'
                        }],
                        target: '_blank'
                    }
                }],
                [{
                    name: 'Latest State',
                    field: 'lastSuccessfulRun.state',
                    class: {
                        match: 'successful', true: 'table-success', false: 'table-danger'
                    }
                }, {
                    name: 'Running',
                    field: 'running',
                    class: {
                        match: true, true: 'table-danger', false: ''
                    }
                }],
                (function () {
                    var row = [];
                    if (data.lastSuccessfulRun && data.lastSuccessfulRun.build.test && data.lastSuccessfulRun.build.test.enabled !== false) {
                        row.push({
                            name: 'Latest Test-Results',
                            text: 'open',
                            link: {
                                uri: ['/doc/', {
                                    field: 'appId'
                                }, '/', {
                                    field: 'lastSuccessfulRun.sequence'
                                }, '/test'],
                                target: '_blank'
                            }

                        });
                    } else {
                        row.push({
                            name: 'Latest Test-Results',
                            text: 'disabled'
                        });
                    }
                    if (data.lastSuccessfulRun && data.lastSuccessfulRun.build.doc && data.lastSuccessfulRun.build.doc.enabled !== false) {
                        row.push({
                            name: 'Latest Documentation',
                            text: 'open',
                            link: {
                                uri: ['/doc/', {
                                    field: 'appId'
                                }, '/', {
                                    field: 'lastSuccessfulRun.sequence'
                                }, '/doc'],
                                target: '_blank'
                            }
                        });
                    } else {
                        row.push({
                            name: 'Latest Documentation',
                            text: 'disabled'
                        });
                    }
                    return row;
                })(),
                (function () {
                    var row = [];
                    if (data.lastSuccessfulRun && data.lastSuccessfulRun.build.lint && data.lastSuccessfulRun.build.lint.enabled !== false) {
                        row.push({
                            name: 'Latest Quality Report',
                            text: 'open',
                            link: {
                                uri: ['/doc/', {
                                    field: 'appId'
                                }, '/', {
                                    field: 'lastSuccessfulRun.sequence'
                                }, '/lint'],
                                target: '_blank'
                            }

                        });
                    } else {
                        row.push({
                            name: 'Latest Quality Report',
                            text: 'disabled'
                        });
                    }
                    row.push({
                        name: 'Source',
                        field: 'lastSuccessfulRun.config.host.name',
                        link: {
                            uri: [{
                                field: 'lastSuccessfulRun.config.host.name'
                            }, '/sys_update_set.do?sys_id=', {
                                field: 'updateSetId'
                            }],
                            target: '_blank'
                        }
                    });
                    return row;
                })()
            ];
            renderDetails($target, config, data);
        });
    };

    var overview = function () {

        $.ajax({
            dataType: 'json',
            url: ROUTE + '/app/'
        }).done(function (data) {

            var config = [{
                name: 'Name',
                field: 'name',
                link: {
                    uri: ['/us#/app/', {
                        field: '_id'
                    }]
                }
            },
            {
                name: 'Repo',
                field: 'git.repository',
                link: {
                    uri: [{
                        field: 'git.url'
                    }],
                    target: '_blank'
                }
            }
            ];

            renderList($('#app'), config, data);

        });
    };

    var application = function () {
        var param = parse(location.hash.slice(1));

        getApplication(param, $('#app'));

        var url = ROUTE + ((param.app) ? '/app/' + param.app + '/us' : '/us');

        // update-set of the app
        $.ajax({
            dataType: 'json',
            url: url
        }).done(function (data) {

            var config = [{
                name: 'Name',
                field: 'name',
                link: {
                    uri: ['/runs#/app/', {
                        field: 'appId'
                    }, '/us/', {
                        field: '_id'
                    }]
                }
            }, {
                name: 'UpdatedBy',
                field: 'updateSet.sys_updated_by'
            }, {
                name: 'Description',
                field: 'updateSet.description'
            }, {
                name: 'Branch',
                field: 'lastSuccessfulRun.config.branchName'
            }, {
                name: 'State',
                field: 'lastSuccessfulRun.state',
                class: {
                    match: 'successful', true: 'text-success', false: 'text-danger'
                }
            }, {
                name: 'Running',
                field: 'running',
                class: {
                    match: true, true: 'text-danger', false: ''
                }
            }];

            renderList($('#us'), config, data);

        });

    };

    var updateset = function () {
        var param = parse(location.hash.slice(1));
        //console.log(param);
        getApplication(param, $('#app'));

        getUpdateSet(param, $('#us'));

        var url = ROUTE + ((param.us) ? '/app/' + param.app + '/us/' + param.us + '/run' : '/run');

        // runs of the update-set
        $.ajax({
            dataType: 'json',
            url: url
        }).done(function (data) {

            var config = [{
                name: 'Sequence',
                field: 'sequence',
                link: {
                    uri: ['/steps#/app/', {
                        field: 'appId'
                    }, '/us/', {
                        field: 'usId'
                    }, '/run/', {
                        field: '_id'
                    }]
                }
            }, {
                name: 'Date',
                field: 'ts'
            }, {
                name: 'Test-Results',
                text: 'open',
                link: {
                    uri: ['/doc/', {
                        field: 'appId'
                    }, '/', {
                        field: 'sequence'
                    }, '/test'],
                    target: '_blank'
                }

            },
            {
                name: 'Documentation',
                text: 'open',
                link: {
                    uri: ['/doc/', {
                        field: 'appId'
                    }, '/', {
                        field: 'sequence'
                    }, '/doc'],
                    target: '_blank'
                }
            },
            {
                name: 'Quality Report',
                text: 'open',
                link: {
                    uri: ['/doc/', {
                        field: 'appId'
                    }, '/', {
                        field: 'sequence'
                    }, '/lint'],
                    target: '_blank'
                }
            },
            {
                name: 'State',
                field: 'state',
                class: {
                    match: 'successful', true: 'table-success', false: 'table-danger'
                }
            }
            ];

            renderList($('#run'), config, data);

        });
    };

    var run = function () {
        var param = parse(location.hash.slice(1));

        getApplication(param, $('#app'));

        getUpdateSet(param, $('#us'), [
            [{
                name: 'Name',
                field: 'name',
                link: {
                    uri: ['/runs#/app/', {
                        field: 'appId'
                    }, '/us/', {
                        field: '_id'
                    }]
                }
            },
            {
                name: 'UpdatedBy',
                field: 'updateSet.sys_updated_by'
            }
            ]]);

        // run details
        $.ajax({
            dataType: 'json',
            url: ROUTE + '/app/' + param.app + '/us/' + param.us + '/run/' + param.run
        }).done(function (data) {
            data = data || {};
            if (data.buildPass === true)
                data.buildPass = 'passed';
            else if (data.buildPass === false)
                data.buildPass = 'failed';
            else
                data.buildPass = '';

            //data.buildPass = (data.buildPass) ? 'passed' : 'failed';

            var config = [
                [{
                    name: 'Sequence',
                    field: 'sequence',
                    link: {
                        uri: ['/runs#/app/', param.app, '/us/', param.us, '/run/', {
                            field: '_id'
                        }]
                    }
                }, {
                    name: 'Date',
                    field: 'ts'
                }],
                [{
                    name: 'State',
                    field: 'state',
                    class: {
                        match: 'successful', true: 'table-success', false: 'table-danger'
                    }
                }, {}],
                [
                    {
                        name: 'Build',
                        field: 'buildPass',
                        class: {
                            match: 'failed', true: 'text-danger', false: 'text-success'
                        }
                    },
                    {
                        name: 'Build Results',
                        field: 'buildResults'
                    }
                ],
                (function () {
                    var row = [];
                    if (data.build && data.build.test && data.build.test.enabled !== false) {
                        row.push({
                            name: 'Test-Results',
                            text: 'open',
                            link: {
                                uri: ['/doc/', param.app, '/', {
                                    field: 'sequence'
                                }, '/test'],
                                target: '_blank'
                            }
                        });
                    } else {
                        row.push({
                            name: 'Test-Results',
                            text: 'disabled'
                        });
                    }
                    if (data.build && data.build.doc && data.build.doc.enabled !== false) {
                        row.push({
                            name: 'Documentation',
                            text: 'open',
                            link: {
                                uri: ['/doc/', param.app, '/', {
                                    field: 'sequence'
                                }, '/doc'],
                                target: '_blank'
                            }
                        });
                    } else {
                        row.push({
                            name: 'Documentation',
                            text: 'disabled'
                        });
                    }
                    return row;
                })(),
                (function () {
                    var row = [];
                    if (data.build && data.build.lint && data.build.lint.enabled !== false) {
                        row.push({
                            name: 'Quality Report',
                            text: 'open',
                            link: {
                                uri: ['/doc/', param.app, '/', {
                                    field: 'sequence'
                                }, '/lint'],
                                target: '_blank'
                            }
                        });
                    } else {
                        row.push({
                            name: 'Quality Report',
                            text: 'disabled'
                        });
                    }
                    row.push({});
                    return row;
                })()
            ];
            renderDetails($('#run'), config, data);

        });

        // all steps of the run
        $.ajax({
            dataType: 'json',
            url: ROUTE + '/app/' + param.app + '/us/' + param.us + '/run/' + param.run + '/step'
        }).done(function (data) {
            var config = [{
                name: 'Date',
                field: 'ts'
            }, {
                name: 'Log',
                field: 'state'
            }];

            /*
            // rotate multiline state values to be bottom up
            data = data.map(function (row) {
                row.state = (row.state || '').split(/\n/).reverse().filter(function (t, index) {
                    return (index === 0 && t.trim().length || index != 0);
                }).join('\n');
                return row;
            });
            */
            renderList($('#step'), config, data);

        });
    };

    var queue = function () {
        $.ajax({
            dataType: 'json',
            url: '/eb/jobs'
        }).done(function (data) {

            var config = [{
                name: 'Name',
                field: 'name'
            }, {
                name: 'Description',
                field: 'description'
            }, {
                name: 'Created',
                field: 'created',
                type: 'ts'
            }, {
                name: 'Completed',
                field: 'completed',
                type: 'ts'
            }, {
                name: 'State',
                field: 'status'
            }, {
                name: 'Result',
                field: 'result'
            }];
            renderList($('#job-queue'), config, data);

        });

        $.ajax({
            dataType: 'json',
            url: '/eb/exe'
        }).done(function (data) {

            var config = [{
                name: 'Name',
                field: 'name'
            }, {
                name: 'Created',
                field: 'created',
                type: 'ts'
            }, {
                name: 'Completed',
                field: 'completed',
                type: 'ts'
            },

            {
                name: 'Host',
                field: 'host'
            },

            {
                name: 'State',
                field: 'status'
            },
            {
                name: 'Client',
                field: 'runByClient'
            }];
            renderList($('#process-queue'), config, data);
        });

        $.ajax({
            dataType: 'json',
            url: '/eb/worker'
        }).done(function (data) {

            var config = [{
                name: 'Host',
                field: 'host'
            }, {
                name: 'Job Worker',
                field: 'status'
            }, {
                name: '# Job',
                field: 'assignedJobs'
            }, {
                name: '# Process',
                field: 'assignedExecutions'
            },
            {
                name: 'Stats',
                field: 'statistics.num'
            }];
            renderList($('#worker-nodes'), config, data);

        });

    };

    return {
        overview: function () {
            $(document).ready(function () {
                overview();
            });
        },
        application: function () {
            $(document).ready(function () {
                application();
            });
        },
        updateset: function () {
            $(document).ready(function () {
                updateset();
            });
        },
        run: function () {
            $(document).ready(function () {
                run();
            });
        },
        queue: function () {
            $(document).ready(function () {
                queue();
            });
        }
    };
};