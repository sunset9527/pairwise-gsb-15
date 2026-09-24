/*
 * Regression tests for audited Stately.js semantics.
 * Each test maps to a specific audited inconsistency.
 */
'use strict';

var Stately = require('../Stately.js');

function assert(condition, message) {
    if (!condition) {
        throw new Error('Assertion failed: ' + message);
    }
}

function assertDeepEqual(actual, expected, message) {
    assert(JSON.stringify(actual) === JSON.stringify(expected),
        message + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
}

function assertThrowsInvalidState(fn, message) {
    var threw = false,
        error;
    try {
        fn();
    } catch (e) {
        threw = true;
        error = e;
    }
    assert(threw, message + ' (expected an InvalidStateError, but nothing was thrown)');
    assert(error instanceof Stately.InvalidStateError,
        message + ' (expected InvalidStateError, got: ' + error + ')');
    assert(error instanceof Error, 'InvalidStateError must be an instanceof Error');
    return error;
}

module.exports = [
    {
        name: 'hooks: exact case match wins over case-insensitive duplicates',
        fn: function () {
            var calls = [];
            var machine = Stately.machine({
                A: { go: 'B' },
                B: {
                    onEnter: function () { calls.push('exact'); },
                    ONENTER: function () { calls.push('upper'); }
                }
            });
            machine.go();
            assertDeepEqual(calls, ['exact'], 'exact `onEnter` must win deterministically');
        }
    },
    {
        name: 'hooks: ambiguous case-insensitive duplicates throw InvalidStateError',
        fn: function () {
            var machine = Stately.machine({
                A: { go: 'B' },
                B: {
                    ONENTER: function () {},
                    OnEnter: function () {}
                }
            });
            assertThrowsInvalidState(function () { machine.go(); },
                'two hooks differing only by case are ambiguous');
        }
    },
    {
        name: 'hooks: onBefore<event> matches its event case-insensitively when unambiguous',
        fn: function () {
            var called = 0;
            var machine = Stately.machine({
                A: {
                    onbeforeCLOSE: function () { called++; },
                    close: 'B'
                },
                B: {}
            });
            machine.close();
            assert(called === 1, 'single case-variant hook must still be found');
        }
    },
    {
        name: 'getMachineEvents excludes special hook functions',
        fn: function () {
            var machine = Stately.machine({
                A: {
                    onEnter: function () {},
                    onLeave: function () {},
                    onBefore: function () {},
                    onAfter: function () {},
                    onBeforeGo: function () {},
                    onAfterGo: function () {},
                    go: 'B',
                    stay: function () {}
                },
                B: { back: 'A' }
            });
            assertDeepEqual(machine.getMachineEvents().sort(), ['go', 'stay'],
                'only real events of the current state must be listed');
            machine.go();
            assertDeepEqual(machine.getMachineEvents(), ['back'], 'events of new state');
        }
    },
    {
        name: 'generic onBefore/onAfter wildcard hooks fire for every event, after specific ones',
        fn: function () {
            var log = [];
            var machine = Stately.machine({
                A: {
                    onBefore: function (e, o, n) { log.push('before*:' + e + ',' + o + ',' + n); },
                    onAfter: function (e, o, n) { log.push('after*:' + e + ',' + o + ',' + n); },
                    onBeforeGo: function () { log.push('beforeGo'); },
                    onAfterGo: function () { log.push('afterGo'); },
                    go: function () { log.push('go'); return this.B; },
                    hop: function () { log.push('hop'); }
                },
                B: { back: 'A' }
            });
            machine.go();
            assertDeepEqual(log, [
                'beforeGo',
                'before*:go,A,A',
                'go',
                'afterGo',
                'after*:go,A,B'
            ], 'specific hooks run before generic wildcard hooks');
            log.length = 0;
            machine.back().hop();
            assertDeepEqual(log, [
                'before*:hop,A,A',
                'hop',
                'after*:hop,A,A'
            ], 'wildcard hooks also fire for events without specific hooks');
        }
    },
    {
        name: 'atomicity: onLeave throwing keeps the machine in the old state',
        fn: function () {
            var machine = Stately.machine({
                A: {
                    onLeave: function () { throw new Error('leave boom'); },
                    go: 'B'
                },
                B: {}
            });
            var error;
            try { machine.go(); } catch (e) { error = e; }
            assert(error && error.message === 'leave boom', 'hook exception must propagate');
            assert(machine.getMachineState() === 'A', 'machine must not be stuck in an intermediate state');
        }
    },
    {
        name: 'atomicity: onEnter throwing leaves the machine committed to the new state',
        fn: function () {
            var machine = Stately.machine({
                A: { go: 'B' },
                B: {
                    onEnter: function () { throw new Error('enter boom'); }
                }
            });
            var error;
            try { machine.go(); } catch (e) { error = e; }
            assert(error && error.message === 'enter boom', 'hook exception must propagate');
            assert(machine.getMachineState() === 'B', 'transition commits before onEnter runs');
        }
    },
    {
        name: 'atomicity: event handler throwing keeps the machine in the old state',
        fn: function () {
            var machine = Stately.machine({
                A: {
                    go: function () { throw new Error('handler boom'); }
                },
                B: {}
            });
            var error;
            try { machine.go(); } catch (e) { error = e; }
            assert(error && error.message === 'handler boom', 'handler exception must propagate');
            assert(machine.getMachineState() === 'A', 'state must be unchanged');
        }
    },
    {
        name: 'atomicity: onAfter throwing keeps the machine in the old state',
        fn: function () {
            var machine = Stately.machine({
                A: {
                    go: 'B',
                    onAfterGo: function () { throw new Error('after boom'); }
                },
                B: {}
            });
            var error;
            try { machine.go(); } catch (e) { error = e; }
            assert(error && error.message === 'after boom', 'hook exception must propagate');
            assert(machine.getMachineState() === 'A', 'state must be unchanged');
        }
    },
    {
        name: 'onAfter sees the original from-state when the handler transitions manually',
        fn: function () {
            var seen;
            var machine = Stately.machine({
                A: {
                    go: function () { this.setMachineState(this.B); },
                    onAfterGo: function (e, o, n) { seen = [e, o, n]; }
                },
                B: {}
            });
            machine.go();
            assertDeepEqual(seen, ['go', 'A', 'B'], 'onAfter must report the state the event started in');
            assert(machine.getMachineState() === 'B', 'manual transition must stick');
        }
    },
    {
        name: 'string shorthand to an unknown state throws InvalidStateError',
        fn: function () {
            var machine = Stately.machine({
                A: { go: 'NOPE' },
                B: {}
            });
            var error = assertThrowsInvalidState(function () { machine.go(); },
                'shorthand `go: "NOPE"` must behave like returning "NOPE" from a handler');
            assert(machine.getMachineState() === 'A', 'state must be unchanged');
            assert(error.message.indexOf('NOPE') !== -1, 'message must name the bad target');
        }
    },
    {
        name: 'handler returning null stays in the current state',
        fn: function () {
            var machine = Stately.machine({
                A: { go: function () { return null; } },
                B: {}
            });
            assert(machine.go() === machine, 'null means stay and returns the machine');
            assert(machine.getMachineState() === 'A', 'state must be unchanged');
        }
    },
    {
        name: 'handler returning an invalid primitive throws a clean InvalidStateError',
        fn: function () {
            var machine = Stately.machine({
                A: { go: function () { return 42; } },
                B: {}
            });
            var error = assertThrowsInvalidState(function () { machine.go(); },
                'returning a number must not crash with a TypeError');
            assert(error.message.indexOf('42') !== -1, 'message must name the bad value');
            assert(error.message.indexOf('function (') === -1, 'message must not leak caller source');
            assert(machine.getMachineState() === 'A', 'state must be unchanged');
        }
    },
    {
        name: 'array return preserves falsy return values',
        fn: function () {
            var machine = Stately.machine({
                A: {
                    zero: function () { return [this.B, 0]; },
                    no: function () { return [this.B, false]; },
                    empty: function () { return [this.B, '']; }
                },
                B: { back: 'A' }
            });
            assert(machine.zero() === 0, '0 must be returned, not the machine');
            machine.back();
            assert(machine.no() === false, 'false must be returned, not the machine');
            machine.back();
            assert(machine.empty() === '', 'empty string must be returned, not the machine');
        }
    },
    {
        name: 'returning an unknown state name throws InvalidStateError before onAfter runs',
        fn: function () {
            var afterCalled = false;
            var machine = Stately.machine({
                A: {
                    go: function () { return 'NOPE'; },
                    onAfterGo: function () { afterCalled = true; }
                },
                B: {}
            });
            var error = assertThrowsInvalidState(function () { machine.go(); },
                'unknown string target must throw InvalidStateError, not TypeError');
            assert(afterCalled === false, 'onAfter must not run for a failed transition');
            assert(error.message.indexOf('NOPE') !== -1, 'message must name the bad target');
            assert(machine.getMachineState() === 'A', 'state must be unchanged');
        }
    },
    {
        name: 'returning a foreign object with a valid state name throws InvalidStateError',
        fn: function () {
            var machine = Stately.machine({
                A: { go: function () { return { name: 'B' }; } },
                B: {}
            });
            assertThrowsInvalidState(function () { machine.go(); },
                'a look-alike object must not silently brick the machine');
            assert(machine.getMachineState() === 'A', 'state must be unchanged');
        }
    },
    {
        name: 'invalid initialStateName throws instead of being silently ignored',
        fn: function () {
            assertThrowsInvalidState(function () {
                Stately.machine({ A: {}, B: {} }, 'NOPE');
            }, 'unknown initial state name must throw');
            assertThrowsInvalidState(function () {
                Stately.machine({ A: {}, B: {} }, 'constructor');
            }, 'inherited property names must not be accepted as states');
        }
    },
    {
        name: 'valid initialStateName still selects the initial state',
        fn: function () {
            var machine = Stately.machine({ A: { go: 'B' }, B: {} }, 'B');
            assert(machine.getMachineState() === 'B', 'explicit initial state must be honored');
        }
    },
    {
        name: 'reserved state names throw at creation',
        fn: function () {
            ['getMachineState', 'setMachineState', 'getMachineEvents'].forEach(function (name) {
                var states = {};
                states[name] = { go: 'X' };
                states.X = {};
                assertThrowsInvalidState(function () { Stately.machine(states); },
                    'state named `' + name + '` collides with machine internals');
            });
        }
    },
    {
        name: 'reserved event names throw at creation',
        fn: function () {
            ['getMachineState', 'getMachineEvents', 'name'].forEach(function (eventName) {
                var states = { A: {}, B: {} };
                states.A[eventName] = function () { return this.B; };
                assertThrowsInvalidState(function () { Stately.machine(states); },
                    'event named `' + eventName + '` collides with the machine API');
            });
        }
    },
    {
        name: 'non-object state definitions throw InvalidStateError',
        fn: function () {
            assertThrowsInvalidState(function () { Stately.machine({ A: null }); }, 'null state');
            assertThrowsInvalidState(function () { Stately.machine({ A: 'B', B: {} }); }, 'string state');
            assertThrowsInvalidState(function () { Stately.machine({ A: [1, 2], B: {} }); }, 'array state');
        }
    },
    {
        name: 'the same state object registered under two names throws',
        fn: function () {
            var shared = { go: 'A' };
            assertThrowsInvalidState(function () {
                Stately.machine({ A: shared, B: shared });
            }, 'aliased state objects make event dispatch ambiguous');
        }
    },
    {
        name: 'events named like Object.prototype members dispatch correctly',
        fn: function () {
            var calls = [];
            var machine = Stately.machine({
                A: {
                    toString: function () { calls.push('toString'); },
                    constructor: function () { calls.push('constructor'); return this.B; },
                    valueOf: function () { calls.push('valueOf'); }
                },
                B: { back: 'A' }
            });
            machine.toString();
            assertDeepEqual(calls, ['toString'], 'own event must run in its state');
            machine.constructor();
            assertDeepEqual(calls, ['toString', 'constructor'], 'constructor event must run');
            assert(machine.getMachineState() === 'B', 'transition must happen');
            assert(machine.toString() === machine, 'unhandled `toString` in state B must be ignored, not call Object.prototype.toString');
            assert(machine.valueOf() === machine, 'unhandled `valueOf` in state B must be ignored');
        }
    },
    {
        name: 'unhandled events are still ignored and return the machine',
        fn: function () {
            var machine = Stately.machine({
                A: { go: 'B' },
                B: { back: 'A' }
            });
            assert(machine.back() === machine, 'unhandled event returns the machine for chaining');
            assert(machine.getMachineState() === 'A', 'state must be unchanged');
        }
    },
    {
        name: 'same-named events in different states dispatch only to the current state',
        fn: function () {
            var calls = [];
            var machine = Stately.machine({
                A: { go: function () { calls.push('A'); return this.B; } },
                B: { go: function () { calls.push('B'); return this.A; } },
                C: {}
            });
            machine.go();
            assertDeepEqual(calls, ['A'], 'only state A handler runs');
            machine.go();
            assertDeepEqual(calls, ['A', 'B'], 'only state B handler runs');
            machine.go();
            machine.go();
            assertDeepEqual(calls, ['A', 'B', 'A', 'B'], 'dispatch alternates with the current state');
        }
    },
    {
        name: 'setMachineState accepts a state name string',
        fn: function () {
            var machine = Stately.machine({
                A: {
                    go: function () { this.setMachineState('B'); }
                },
                B: {}
            });
            machine.go();
            assert(machine.getMachineState() === 'B', 'string target must resolve');
            assertThrowsInvalidState(function () {
                Stately.machine({
                    A: { go: function () { this.setMachineState('NOPE'); } },
                    B: {}
                }).go();
            }, 'unknown string target must throw');
        }
    },
    {
        name: 'invalid transition error message names the state, not caller source',
        fn: function () {
            var machine = Stately.machine({
                A: { go: function () { return {}; } },
                B: {}
            });
            var error = assertThrowsInvalidState(function () { machine.go(); },
                'invalid object target must throw');
            assert(error.message.indexOf('setMachineState') === -1, 'message must not contain internals');
        }
    },
    {
        name: 'machine factory from a states-producing function still works',
        fn: function () {
            var machine = Stately.machine(function () {
                return { A: { go: 'B' }, B: {} };
            });
            machine.go();
            assert(machine.getMachineState() === 'B', 'function form must be supported');
        }
    }
];
