const path = require('path');
module.exports = {
    'files': [
        {
            'source': path.resolve(__dirname, 'atf-wrapper.js'),
            'target': 'test/atf-wrapper.js'
        },
        {
            'source': path.resolve(__dirname, 'gulpfile.js'),
            'target': 'gulpfile.js'
        },
        {
            'source': path.resolve(__dirname, 'package.json'),
            'target': 'package.json'
        },
        {
            'source': path.resolve(__dirname, 'package.lock.json'),
            'target': 'package-lock.json'
        }
    ],
    'gulp': {
        'init': {
            'breakOnError': true
        },
        'lint': {
            'breakOnError': false,
            'enabled': true,
            'files': [],
            'config': {
                'fix': true,
                'extends': 'eslint:recommended',
                'rules': {
                    'valid-jsdoc': 'warn',
                    'no-alert': 'error',
                    'no-bitwise': 'off',
                    'camelcase': 'warn',
                    'curly': 'warn',
                    'eqeqeq': 'warn',
                    'no-eq-null': 'off',
                    'guard-for-in': 'warn',
                    'no-empty': 'warn',
                    'no-use-before-define': 'off',
                    'no-obj-calls': 'warn',
                    'no-unused-vars': 'off',
                    'new-cap': 'warn',
                    'no-shadow': 'off',
                    'strict': 'off',
                    'no-invalid-regexp': 'warn',
                    'comma-dangle': 'warn',
                    'no-undef': 'warn',
                    'no-new': 'warn',
                    'no-extra-semi': 'warn',
                    'no-debugger': 'warn',
                    'no-caller': 'warn',
                    'semi': 'warn',
                    'quotes': 'off',
                    'no-unreachable': 'warn'
                },
                'globals': [
                    'jQuery',
                    '$',
                    'sn_ws_err',
                    'gs',
                    'sn_ws',
                    'Class',
                    'GlideDateTime',
                    'GlideRecord',
                    'GlideProperties',
                    'GlideAggregate',
                    'GlideFilter',
                    'GlideTableHierarchy',
                    'TableUtils',
                    'JSON',
                    'Packages',
                    'g_form',
                    'current',
                    'previous',
                    'g_navigation',
                    'g_document',
                    'GlideDialogWindow',
                    'GlideAjax',
                    'gel',
                    'request',
                    'response',
                    'parent',
                    'angular',
                    '$j',
                    'action',
                    'g_list',
                    'GlideModal',
                    'GwtMessage',
                    'g_i18n'
                ],
                'envs': [
                    'node',
                    'browser'
                ]
            }
        },
        'doc': {
            'breakOnError': false,
            'enabled': true,
            'config': {
                'tags': {
                    'allowUnknownTags': true,
                    'dictionaries': [
                        'jsdoc',
                        'closure'
                    ]
                },
                'source': {
                    'includePattern': '.+\\.js(doc|x)?$',
                    'excludePattern': '(^|\\/|\\\\)_'
                },
                'sourceType': 'script',
                'opts': {
                    'explain': false,
                    'recurse': true,
                    'private': true,
                    'verbose': true,
                    'destination': './docs_default/gen'
                },
                'plugins': [
                    'plugins/underscore'
                ],
                'templates': {
                    'cleverLinks': true,
                    'monospaceLinks': false,
                    'default': {
                        'outputSourceFiles': true,
                        'useLongnameInNav': true
                    },
                    'systemName': '<Name>',
                    'includeDate': true,
                    'path': 'ink-docstrap',
                    'theme': 'spacelab',
                    'navType': 'vertical',
                    'linenums': true,
                    'inverseNav': true,
                    'collapseSymbols': true,
                    'outputSourceFiles': true,
                    'outputSourcePath': true,
                    'syntaxTheme': 'default',
                    'dateFormat': 'MMMM Do YYYY, h:mm:ss a'
                },
                'log': {
                    'info': false,
                    'error': false
                }
            }
        },
        'test': {
            'breakOnError': true,
            'enabled': true,
            'suites': [],
            'tests': [],
            'title': 'Name'
        }
    }
};
