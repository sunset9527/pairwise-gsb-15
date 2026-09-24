/*
 * Property-based tests for Stately.js.
 *
 * Generates large numbers of random state machine definitions and random
 * event sequences, then asserts against a simple reference model that:
 *
 *   - the machine state always matches the model after every event,
 *   - the machine state is always one of the defined states,
 *   - event return values match the model (machine chaining or value),
 *   - getMachineEvents() always lists exactly the events of the current state,
 *   - special hooks fire in the documented order with the documented
 *     (event, oldState, newState) arguments,
 *   - exceptions from hooks/handlers never leave the machine in an
 *     intermediate or undefined state.
 *
 * Runs are deterministic (seeded PRNG) so failures are reproducible.
 */
'use strict';

var Stately = require('../Stately.js');

function assert(condition, message) {
    if (!condition) {
        throw new Error('Assertion failed: ' + message);
    }
}

function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function randomCase(str, rand) {
    return str.split('').map(function (ch) {
        return rand() < 0.5 ? ch.toUpperCase() : ch.toLowerCase();
    }).join('');
}

function pick(rand, values) {
    return values[Math.floor(rand() * values.length)];
}

/*
 * Generates a random machine plus a reference model.
 * Hooks are attached with randomized casing to property-test the
 * case-insensitive (but unambiguous) hook resolution.
 */
function generateMachine(rand) {
    var stateCount = 2 + Math.floor(rand() * 4);
    var stateNames = [];
    for (var i = 0; i < stateCount; i++) {
        stateNames.push('STATE' + i);
    }

    var eventCount = 1 + Math.floor(rand() * 4);
    var eventNames = [];
    for (i = 0; i < eventCount; i++) {
        eventNames.push('event' + i);
    }

    var log = [];
    var statesObject = {};
    var model = {};

    stateNames.forEach(function (stateName) {
        var state = {};
        var stateModel = {
            events: {},
            onEnter: false,
            onLeave: false,
            onBefore: false,
            onAfter: false,
            before: {},
            after: {}
        };

        eventNames.forEach(function (eventName) {
            if (rand() < 0.65) {
                var target = stateNames[Math.floor(rand() * stateCount)];
                var kind = Math.floor(rand() * 5);
                var spec = { target: target, shorthand: false, hasValue: false, value: undefined };

                if (kind === 0) {
                    spec.target = stateName;
                    state[eventName] = function () { log.push('handler:' + eventName); };
                } else if (kind === 1) {
                    state[eventName] = function () { log.push('handler:' + eventName); return this[target]; };
                } else if (kind === 2) {
                    state[eventName] = function () { log.push('handler:' + eventName); return target; };
                } else if (kind === 3) {
                    spec.shorthand = true;
                    state[eventName] = target;
                } else {
                    var value = pick(rand, [0, false, '', 'value', null, { tag: 'obj' }]);
                    spec.hasValue = true;
                    spec.value = value;
                    state[eventName] = function () { log.push('handler:' + eventName); return [this[target], value]; };
                }
                stateModel.events[eventName] = spec;

                if (rand() < 0.4) {
                    state[randomCase('onBefore' + eventName, rand)] = function (e, o, n) {
                        log.push('before:' + eventName + '|' + e + ',' + o + ',' + n);
                    };
                    stateModel.before[eventName] = true;
                }
                if (rand() < 0.4) {
                    state[randomCase('onAfter' + eventName, rand)] = function (e, o, n) {
                        log.push('after:' + eventName + '|' + e + ',' + o + ',' + n);
                    };
                    stateModel.after[eventName] = true;
                }
            }
        });

        if (rand() < 0.5) {
            state[randomCase('onEnter', rand)] = function (e, o, n) {
                log.push('enter:' + stateName + '|' + e + ',' + o + ',' + n);
            };
            stateModel.onEnter = true;
        }
        if (rand() < 0.5) {
            state[randomCase('onLeave', rand)] = function (e, o, n) {
                log.push('leave:' + stateName + '|' + e + ',' + o + ',' + n);
            };
            stateModel.onLeave = true;
        }
        if (rand() < 0.4) {
            state[randomCase('onBefore', rand)] = function (e, o, n) {
                log.push('before:*|' + e + ',' + o + ',' + n);
            };
            stateModel.onBefore = true;
        }
        if (rand() < 0.4) {
            state[randomCase('onAfter', rand)] = function (e, o, n) {
                log.push('after:*|' + e + ',' + o + ',' + n);
            };
            stateModel.onAfter = true;
        }

        statesObject[stateName] = state;
        model[stateName] = stateModel;
    });

    return {
        statesObject: statesObject,
        stateNames: stateNames,
        eventNames: eventNames,
        model: model,
        log: log
    };
}

function expectedLog(model, stateName, eventName, spec) {
    var stateModel = model[stateName];
    var entries = [];
    if (stateModel.before[eventName]) {
        entries.push('before:' + eventName + '|' + eventName + ',' + stateName + ',' + stateName);
    }
    if (stateModel.onBefore) {
        entries.push('before:*|' + eventName + ',' + stateName + ',' + stateName);
    }
    if (!spec.shorthand) {
        entries.push('handler:' + eventName);
    }
    if (stateModel.after[eventName]) {
        entries.push('after:' + eventName + '|' + eventName + ',' + stateName + ',' + spec.target);
    }
    if (stateModel.onAfter) {
        entries.push('after:*|' + eventName + ',' + stateName + ',' + spec.target);
    }
    if (spec.target !== stateName) {
        if (stateModel.onLeave) {
            entries.push('leave:' + stateName + '|' + eventName + ',' + stateName + ',' + spec.target);
        }
        if (model[spec.target].onEnter) {
            entries.push('enter:' + spec.target + '|' + eventName + ',' + stateName + ',' + spec.target);
        }
    }
    return entries;
}

function context(machineIndex, step, eventName, extra) {
    return '[machine #' + machineIndex + ', step ' + step + ', event `' + eventName + '`] ' + extra;
}

function propertyTransitionsAndHooks() {
    var MACHINE_COUNT = 300;
    var STEPS = 80;

    for (var m = 0; m < MACHINE_COUNT; m++) {
        var rand = mulberry32((m * 2654435761) >>> 0);
        var gen = generateMachine(rand);
        var machine = Stately.machine(gen.statesObject);
        var current = gen.stateNames[0];

        assert(machine.getMachineState() === current, 'machine starts in the first state');

        for (var step = 0; step < STEPS; step++) {
            var eventName = gen.eventNames[Math.floor(rand() * gen.eventNames.length)];
            var spec = gen.model[current].events[eventName];

            if (typeof machine[eventName] !== 'function') {
                assert(!gen.stateNames.some(function (s) { return gen.model[s].events[eventName]; }),
                    context(m, step, eventName, 'event missing from machine although defined'));
                continue;
            }

            gen.log.length = 0;
            var ret = machine[eventName]();

            if (!spec) {
                assert(ret === machine, context(m, step, eventName, 'unhandled event must return the machine'));
                assert(gen.log.length === 0, context(m, step, eventName, 'unhandled event must not fire hooks'));
            } else {
                var expected = expectedLog(gen.model, current, eventName, spec);
                assert(JSON.stringify(gen.log) === JSON.stringify(expected),
                    context(m, step, eventName, 'hook log mismatch\n  expected: ' + JSON.stringify(expected)
                        + '\n  actual:   ' + JSON.stringify(gen.log)));
                var expectedRet = spec.hasValue ? spec.value : machine;
                assert(ret === expectedRet, context(m, step, eventName, 'event return value mismatch'));
                current = spec.target;
            }

            assert(machine.getMachineState() === current,
                context(m, step, eventName, 'state mismatch: expected ' + current + ', got ' + machine.getMachineState()));
            assert(gen.stateNames.indexOf(machine.getMachineState()) !== -1,
                context(m, step, eventName, 'machine is in an undefined state'));

            var expectedEvents = Object.keys(gen.model[current].events).sort();
            assert(JSON.stringify(machine.getMachineEvents().slice().sort()) === JSON.stringify(expectedEvents),
                context(m, step, eventName, 'getMachineEvents mismatch in state ' + current));
        }
    }
}

/*
 * Generates machines whose hooks and handlers may throw, and asserts the
 * atomicity properties: a throw before the commit point leaves the machine
 * in the old state; a throw in onEnter leaves it in the new state; the
 * machine always stays usable and in a defined state.
 */
function generateFaultyMachine(rand, BOOM) {
    var stateCount = 2 + Math.floor(rand() * 4);
    var stateNames = [];
    for (var i = 0; i < stateCount; i++) {
        stateNames.push('STATE' + i);
    }

    var eventCount = 1 + Math.floor(rand() * 3);
    var eventNames = [];
    for (i = 0; i < eventCount; i++) {
        eventNames.push('event' + i);
    }

    var statesObject = {};
    var model = {};

    function maybeFaulty(randValue) {
        return randValue < 0.3;
    }

    stateNames.forEach(function (stateName) {
        var state = {};
        var stateModel = {
            events: {},
            onEnterThrows: null,
            onLeaveThrows: null,
            onBeforeThrows: null,
            onAfterThrows: null,
            before: {},
            after: {}
        };

        eventNames.forEach(function (eventName) {
            if (rand() < 0.7) {
                var target = stateNames[Math.floor(rand() * stateCount)];
                var kind = Math.floor(rand() * 5);
                var spec = { target: target, throws: false };

                if (kind === 0) {
                    spec.target = stateName;
                    state[eventName] = function () {};
                } else if (kind === 1) {
                    state[eventName] = function () { return this[target]; };
                } else if (kind === 2) {
                    state[eventName] = function () { return target; };
                } else if (kind === 3) {
                    state[eventName] = target;
                } else {
                    spec.throws = true;
                    state[eventName] = function () { throw BOOM; };
                }
                stateModel.events[eventName] = spec;

                if (rand() < 0.4) {
                    var beforeThrows = maybeFaulty(rand());
                    state['onBefore' + eventName] = beforeThrows
                        ? function () { throw BOOM; }
                        : function () {};
                    stateModel.before[eventName] = { throws: beforeThrows };
                }
                if (rand() < 0.4) {
                    var afterThrows = maybeFaulty(rand());
                    state['onAfter' + eventName] = afterThrows
                        ? function () { throw BOOM; }
                        : function () {};
                    stateModel.after[eventName] = { throws: afterThrows };
                }
            }
        });

        if (rand() < 0.5) {
            var enterThrows = maybeFaulty(rand());
            state.onEnter = enterThrows ? function () { throw BOOM; } : function () {};
            stateModel.onEnterThrows = enterThrows;
        }
        if (rand() < 0.5) {
            var leaveThrows = maybeFaulty(rand());
            state.onLeave = leaveThrows ? function () { throw BOOM; } : function () {};
            stateModel.onLeaveThrows = leaveThrows;
        }
        if (rand() < 0.4) {
            var genericBeforeThrows = maybeFaulty(rand());
            state.onBefore = genericBeforeThrows ? function () { throw BOOM; } : function () {};
            stateModel.onBeforeThrows = genericBeforeThrows;
        }
        if (rand() < 0.4) {
            var genericAfterThrows = maybeFaulty(rand());
            state.onAfter = genericAfterThrows ? function () { throw BOOM; } : function () {};
            stateModel.onAfterThrows = genericAfterThrows;
        }

        statesObject[stateName] = state;
        model[stateName] = stateModel;
    });

    return {
        statesObject: statesObject,
        stateNames: stateNames,
        eventNames: eventNames,
        model: model
    };
}

function propertyExceptionAtomicity() {
    var MACHINE_COUNT = 300;
    var STEPS = 80;

    for (var m = 0; m < MACHINE_COUNT; m++) {
        var BOOM = new Error('boom');
        var rand = mulberry32((m * 40503 + 7) >>> 0);
        var gen = generateFaultyMachine(rand, BOOM);
        var machine = Stately.machine(gen.statesObject);
        var current = gen.stateNames[0];

        for (var step = 0; step < STEPS; step++) {
            var eventName = gen.eventNames[Math.floor(rand() * gen.eventNames.length)];

            if (typeof machine[eventName] !== 'function') {
                continue;
            }

            var threw = false;
            var error = null;
            try {
                machine[eventName]();
            } catch (e) {
                threw = true;
                error = e;
            }

            var stateModel = gen.model[current];
            var spec = stateModel.events[eventName];
            var expectThrow = false;
            var next = current;

            if (spec) {
                if (stateModel.before[eventName] && stateModel.before[eventName].throws) {
                    expectThrow = true;
                } else if (stateModel.onBeforeThrows) {
                    expectThrow = true;
                } else if (spec.throws) {
                    expectThrow = true;
                } else if (stateModel.after[eventName] && stateModel.after[eventName].throws) {
                    expectThrow = true;
                } else if (stateModel.onAfterThrows) {
                    expectThrow = true;
                } else if (spec.target !== current && stateModel.onLeaveThrows) {
                    expectThrow = true;
                } else {
                    next = spec.target;
                    if (spec.target !== current && gen.model[spec.target].onEnterThrows) {
                        expectThrow = true;
                    }
                }
            }

            assert(threw === expectThrow,
                context(m, step, eventName, 'throw mismatch: expected ' + (expectThrow ? 'throw' : 'no throw')
                    + ' in state ' + current));
            if (threw) {
                assert(error === BOOM, context(m, step, eventName, 'unexpected error: ' + error));
            }
            current = next;
            assert(machine.getMachineState() === current,
                context(m, step, eventName, 'state mismatch after exception semantics: expected '
                    + current + ', got ' + machine.getMachineState()));
            assert(gen.stateNames.indexOf(machine.getMachineState()) !== -1,
                context(m, step, eventName, 'machine left in an undefined state'));
        }
    }
}

module.exports = [
    {
        name: 'property: random machines and event sequences always match the reference model (300 machines x 80 events)',
        fn: propertyTransitionsAndHooks
    },
    {
        name: 'property: hook/handler exceptions never leave the machine in an intermediate state (300 machines x 80 events)',
        fn: propertyExceptionAtomicity
    }
];
