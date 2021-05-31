
function isCrossOriginFrame() {
    try {
        return (document.location.hostname !== window.parent.location.hostname);
    } catch (e) {
        return true;
    }
}
if (isCrossOriginFrame()) {
    // eslint-disable-next-line no-console
    console.log('remove iframe');
    try {
        window.top.location.href = self.location.href;
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
    }
}

// eslint-disable-next-line no-unused-vars
var app = function () {

    var ROUTE = '/dao';

    var parse = function (hash) {
        var regex = /\/app(?:\/([^/]+))?(?:\/us)?(?:\/([^/]+))?(?:\/run)?(?:\/([^/]+))?(?:\/step)?/gi;
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

        if (!param.app)
            return;

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

        if (!param.us)
            return;

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
                    field: 'run.config.branchName',
                    link: {
                        uri: [{
                            field: 'run.config.git.branchLink'
                        }],
                        target: '_blank'
                    }
                }],
                [{
                    name: 'Latest State',
                    field: 'run.state',
                    class: {
                        match: 'successful', true: 'table-success', false: 'table-danger'
                    }
                }, {
                    name: 'Running',
                    field: 'running',
                    class: {
                        match: 'YES', true: 'table-danger', false: ''
                    }
                }],
                (function () {
                    var row = [];
                    if (data.run && data.run.build.test && data.run.build.test.enabled !== false) {
                        row.push({
                            name: 'Latest Test-Results',
                            text: 'open',
                            link: {
                                uri: ['/doc/', {
                                    field: 'run.dir.web'
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
                    if (data.run && data.run.build.doc && data.run.build.doc.enabled !== false) {
                        row.push({
                            name: 'Latest Documentation',
                            text: 'open',
                            link: {
                                uri: ['/doc/', {
                                    field: 'run.dir.web'
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
                    if (data.run && data.run.build.lint && data.run.build.lint.enabled !== false) {
                        row.push({
                            name: 'Latest Quality Report',
                            text: 'open',
                            link: {
                                uri: ['/doc/', {
                                    field: 'run.dir.web'
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
                        field: 'run.config.host.name',
                        link: {
                            uri: [{
                                field: 'run.config.host.name'
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
                field: 'run.config.branchName'
            }, {
                name: 'State',
                field: 'run.state',
                class: {
                    match: 'successful', true: 'text-success', false: 'text-danger'
                }
            }, {
                name: 'Running',
                field: 'running',
                class: {
                    match: 'YES', true: 'text-danger', false: ''
                }
            }];

            renderList($('#us'), config, data);

        });

    };

    var deployment = function () {
        var param = parse(location.hash.slice(1));
        //console.log(param);
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
        if (!param.app || !param.us || !param.run)
            return;

        // run details
        $.ajax({
            dataType: 'json',
            url: ROUTE + '/app/' + param.app + '/us/' + param.us + '/deployment/' + param.run
        }).done(function (data) {
            data = data || {};
            if (data.state == 'completed')
                data.duration = (new Date(data.end).getTime() - new Date(data.start).getTime()) / 1000;

            data.start = (data.start == -1) ? '' : new Date(data.start).toLocaleString();
            data.end = (data.end == -1) ? '' : new Date(data.end).toLocaleString();

            var config = [
                [{
                    name: 'State',
                    field: 'state',
                    class: {
                        match: 'completed', true: 'table-success', false: 'table-danger'
                    }
                }, {
                    name: 'Duration (sec)',
                    field: 'duration'

                }],
                [{
                    name: 'From',
                    field: 'from'

                }, {
                    name: 'To',
                    field: 'to'
                }],
                [{
                    name: 'Start',
                    field: 'start'

                }, {
                    name: 'End',
                    field: 'end'
                }],
                [{
                    name: 'Mode',
                    field: 'mode'

                }, {
                    name: 'Type',
                    field: 'type'
                }]
            ];
            renderDetails($('#deployment'), config, data);
            
            
            var missingRecords = Object.values(data.missingRecords || {});
            if(missingRecords.length){
                
                var listingConfig = [{
                    name: 'Class Name',
                    field: 'className'
                }, {
                    name: 'Sys Id',
                    field: 'sysId'
                }, {
                    name: 'Status',
                    field: 'status'
                }, {
                    name: 'Host',
                    field: 'host'
                }, {
                    name: 'Resolved by',
                    field: 'resolvedBy'
                }, {
                    name: 'Link',
                    text: 'open',
                    link: {
                        uri: [{
                            field: 'link'
                        }],
                        target: '_blank'
                    }
                }, {
                    name: 'Description',
                    field: 'description'
    
                }];
    
                renderList($('#deployment-missing-records'), listingConfig, missingRecords);
            }

            var issues = Object.values(data.issues || {});
            if(issues.length){
                
                var issuesConfig = [{
                    name: 'Type',
                    field: 'type'
                }, {
                    name: 'Description',
                    field: 'name'
                }, {
                    name: 'Link',
                    text: 'open',
                    link: {
                        uri: [{
                            field: 'link'
                        }],
                        target: '_blank'
                    }
                }];
                renderList($('#deployment-issues'), issuesConfig, issues);
            }
            
        });
    };

    var updateset = function () {
        var param = parse(location.hash.slice(1));
        //console.log(param);
        getApplication(param, $('#app'));

        getUpdateSet(param, $('#us'));

        // run details

        var url = ROUTE + ((param.us) ? '/app/' + param.app + '/us/' + param.us + '/run' : '/run');
        // runs of the update-set
        $.ajax({
            dataType: 'json',
            url: url
        }).done(function (data) {

            data = data.map(function (d) {
                d.commitId = (d.commitId) ? d.commitId.substr(0, 8) : '';
                return d;
            });

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
                name: 'ID',
                field: 'commitId'
            }, {
                name: 'Date',
                field: 'ts'
            }, {
                name: 'Test-Results',
                text: 'open',
                link: {
                    uri: ['/doc/', {
                        field: 'dir.web'
                    }, '/test'],
                    target: '_blank'
                }

            },
            {
                name: 'Documentation',
                text: 'open',
                link: {
                    uri: ['/doc/', {
                        field: 'dir.web'
                    }, '/doc'],
                    target: '_blank'
                }
            },
            {
                name: 'Quality Report',
                text: 'open',
                link: {
                    uri: ['/doc/', {
                        field: 'dir.web'
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

        url = ROUTE + ((param.us) ? '/app/' + param.app + '/us/' + param.us + '/deployment' : '/deployment');
        // runs of the update-set
        $.ajax({
            dataType: 'json',
            url: url
        }).done(function (data) {

            data = data.map(function (d) {
                if (d.state == 'completed')
                    d.duration = (new Date(d.end).getTime() - new Date(d.start).getTime()) / 1000;

                d.start = (d.start == -1) ? '' : new Date(d.start).toLocaleString();
                d.end = (d.end == -1) ? '' : new Date(d.end).toLocaleString();

                d.commitId = (d.commitId) ? d.commitId.substr(0, 8) : '';
                return d;
            });

            var config = [{
                name: 'Start',
                field: 'start',
                link: {
                    uri: ['/deployment#/app/', {
                        field: 'appId'
                    }, '/us/', {
                        field: 'usId'
                    }, '/run/', {
                        field: '_id'
                    }]
                }
            }, {
                name: 'ID',
                field: 'commitId'
            }, {
                name: 'Duration (s)',
                field: 'duration'
            },
            {
                name: 'Source',
                field: 'from'
            }, {
                name: 'Target',
                field: 'to'
            },
            {
                name: 'Type',
                field: 'type'

            },
            {
                name: 'Mode',
                field: 'mode'

            },
            {
                name: 'State',
                field: 'state',
                class: {
                    match: 'completed', true: 'table-success', false: 'table-danger'
                }
            }
            ];

            renderList($('#deployment'), config, data);

        });

        url = ROUTE + ((param.us) ? '/app/' + param.app + '/us/' + param.us + '/test' : '/test');
        // runs of the update-set
        $.ajax({
            dataType: 'json',
            url: url
        }).done(function (data) {

            data = data.map(function (d) {
                d.suites = (d.suites) ? d.suites.length : 0;
                d.tests = (d.tests) ? d.tests.length : 0;
                d.commitId = (d.commitId) ? d.commitId.substr(0, 8) : '';
                return d;
            });
            var config = [{
                name: 'Date',
                field: 'ts',
                __link: {
                    uri: ['/deployment#/app/', {
                        field: 'appId'
                    }, '/us/', {
                        field: 'usId'
                    }, '/run/', {
                        field: '_id'
                    }]
                }
            }, {
                name: 'ID',
                field: 'commitId'
            },
            {
                name: 'Run On',
                field: 'on'
            },
            {
                name: 'Suites',
                field: 'suites'

            },
            {
                name: 'Tests',
                field: 'tests'

            },
            {
                name: 'State',
                field: 'state'
            },
            {
                name: 'Passed',
                field: 'passed',
                class: {
                    match: false, false: '', true: 'table-danger'
                }
            }
            ];

            renderList($('#test'), config, data);

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
        if (!param.app || !param.us || !param.run)
            return;

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
                                uri: ['/doc/', {
                                    field: 'dir.web'
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
                                uri: ['/doc/', {
                                    field: 'dir.web'
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
                                uri: ['/doc/', {
                                    field: 'dir.web'
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
                    row.push({
                        name: 'CommitId',
                        field: 'commitId'
                    });
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
                name: 'Server',
                field: 'serverHash'
            }, {
                name: 'Name',
                field: 'name'
            }, {
                name: 'Description',
                field: 'description'
            }, {
                name: 'Background',
                field: 'background'
            }, {
                name: 'Exclusive',
                field: 'exclusiveId'
            }, {
                name: 'State',
                field: 'status'
            }, {
                name: 'Host',
                field: 'host'
            }, {
                name: 'Worker',
                field: 'workerId'
            }, {
                name: 'Created',
                field: 'created',
                type: 'ts'
            }, {
                name: 'Completed',
                field: 'completed',
                type: 'ts'
            }, {
                name: 'Error',
                field: 'error'
            }];
            renderList($('#job-queue'), config, data);

        });

        $.ajax({
            dataType: 'json',
            url: '/eb/exe'
        }).done(function (data) {

            var config = [{
                name: 'Server',
                field: 'serverHash'
            }, {
                name: 'Name',
                field: 'name'
            }, {
                name: 'Description',
                field: 'description'
            }, {
                name: 'Background',
                field: 'background'
            }, {
                name: 'Exclusive',
                field: 'exclusiveId'
            }, {
                name: 'State',
                field: 'status'
            }, {
                name: 'Host',
                field: 'host'
            }, {
                name: 'Worker',
                field: 'workerId'
            }, {
                name: 'Created',
                field: 'created',
                type: 'ts'
            }, {
                name: 'Completed',
                field: 'completed',
                type: 'ts'
            }, {
                name: 'Error',
                field: 'error'
            }];
            renderList($('#process-queue'), config, data);
        });

        $.ajax({
            dataType: 'json',
            url: '/eb/worker'
        }).done(function (data) {

            var config = [{
                name: 'Server',
                field: 'serverHash'
            },{
                name: 'Worker',
                field: '_id'
            }, {
                name: 'Worker Host',
                field: 'host'
            }, {
                name: 'Worker Status',
                field: 'status'
            }, {
                name: '# Job',
                field: 'assignedJobs'
            }, {
                name: '# Process',
                field: 'assignedExecutions'
            }, {
                name: 'Stats',
                field: 'statistics.num'
            }, {
                name: 'Updated',
                field: 'updatedAt',
                type: 'ts'
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
        },
        deployment: function () {
            $(document).ready(function () {
                deployment();
            });
        }
    };
};
