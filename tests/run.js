/*
 * Test runner for Stately.js.
 *
 * Runs three suites:
 *   1. the legacy browser test suite (tests/tests.js) under a minimal DOM
 *      stub, as a regression net,
 *   2. the semantic regression tests (tests/regression.js),
 *   3. the property-based tests (tests/property.js).
 *
 * Exits with a non-zero code if anything fails.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var Stately = require('../Stately.js');

var total = 0;
var failures = [];

function record(name, error) {
    total++;
    if (error) {
        failures.push(name);
        console.log('not ok - ' + name);
        console.log('    ' + String(error && error.stack || error).split('\n').join('\n    '));
    } else {
        console.log('ok - ' + name);
    }
}

function runSuite(title, tests) {
    console.log('# ' + title);
    tests.forEach(function (test) {
        var error = null;
        try {
            test.fn();
        } catch (e) {
            error = e;
        }
        record(test.name, error);
    });
}

/*
 * Runs the legacy browser suite (tests/tests.js) inside a vm with a stubbed
 * `document`, and reports one result per legacy test case.
 */
function runLegacySuite(callback) {
    console.log('# legacy browser suite (tests/tests.js)');
    var element = { innerHTML: '' };
    var sandbox = {
        Stately: Stately,
        document: {
            getElementById: function () { return element; }
        },
        console: console
    };
    //mimic browsers, where `this` inside a setTimeout callback is the global object
    sandbox.setTimeout = function (fn, ms) {
        return setTimeout(function () { fn.call(sandbox); }, ms);
    };
    vm.createContext(sandbox);
    var source = fs.readFileSync(path.join(__dirname, 'tests.js'), 'utf8');
    vm.runInContext(source, sandbox, { filename: 'tests.js' });

    var waited = 0;
    var interval = setInterval(function () {
        waited += 20;
        if (!/Total Tests/.test(element.innerHTML)) {
            if (waited > 10000) {
                clearInterval(interval);
                record('legacy suite completes', new Error('timed out waiting for legacy suite'));
                callback();
            }
            return;
        }
        clearInterval(interval);

        var totalMatch = element.innerHTML.match(/Total Tests: (\d+)/);
        var blockPattern = /<div class="result result-(error|success)" ><div class="result-title">(.*?)<\/div>(?:<div class="result-errors"[^>]*>([\s\S]*?)<\/div>)?<\/div>/g;
        var match;
        while ((match = blockPattern.exec(element.innerHTML)) !== null) {
            var ok = match[1] === 'success';
            var title = match[2].replace(/\s+::.*$/, '');
            var errors = (match[3] || '').split('<br />').join('; ');
            record('legacy ' + title, ok ? null : new Error(errors || 'legacy test failed'));
        }
        console.log('# legacy assertions: ' + (totalMatch ? totalMatch[1] : '?'));
        callback();
    }, 20);
}

runLegacySuite(function () {
    runSuite('semantic regression tests', require('./regression.js'));
    runSuite('property-based tests', require('./property.js'));

    console.log('');
    console.log('# total: ' + total + ', failed: ' + failures.length);
    if (failures.length > 0) {
        console.log('# failing tests:');
        failures.forEach(function (name) {
            console.log('#   - ' + name);
        });
        process.exit(1);
    }
    console.log('# all tests passed');
});
