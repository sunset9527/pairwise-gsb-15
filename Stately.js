/*
 * Stately.js: A JavaScript based finite-state machine (FSM) engine.
 *
 * Copyright (c) 2012 Florian Schäfer (florian.schaefer@gmail.com)
 * Released under MIT license.
 *
 * Version: 2.0.0
 *
 */
(function (root, factory) {
    if (typeof exports === 'object') {
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        define(factory);
    } else {
        root.Stately = factory();
    }
})(this, function () {

    var
        toString = Object.prototype.toString,

        hasOwnProperty = Object.prototype.hasOwnProperty,

        InvalidStateError = (function () {

            function InvalidStateError(message) {

                this.name = 'InvalidStateError';

                this.message = message;

                if (Error.captureStackTrace) {

                    Error.captureStackTrace(this, InvalidStateError);
                }
            }

            InvalidStateError.prototype = Object.create(Error.prototype);

            InvalidStateError.prototype.constructor = InvalidStateError;

            return InvalidStateError;
        })();

    function Stately(statesObject, initialStateName) {

        if (typeof statesObject === 'function') {

            statesObject = statesObject();
        }

        if (toString.call(statesObject) !== '[object Object]') {

            throw new InvalidStateError('Stately.js: Invalid states object: `' + statesObject + '`.');
        }

        var
            currentState,

            stateStore,

            stateMachine,

            transition;

        function hasOwn(object, property) {

            return hasOwnProperty.call(object, property);
        }

        function isSpecialEventName(eventName) {

            return /^onEnter$/i.test(eventName)
                || /^onLeave$/i.test(eventName)
                || /^onBefore/i.test(eventName)
                || /^onAfter/i.test(eventName);
        }

        function getStateByName(stateName) {

            var state = hasOwn(stateStore, stateName) ? stateStore[stateName] : undefined;

            return toString.call(state) === '[object Object]' ? state : undefined;
        }

        function isStateObject(object) {

            return toString.call(object) === '[object Object]'
                && typeof object.name === 'string'
                && hasOwn(stateStore, object.name)
                && stateStore[object.name] === object;
        }

        function invalidStateError(value) {

            return new InvalidStateError('Stately.js: Transitioned into invalid state: `'
                + (typeof value === 'string' ? value : (value && value.name ? value.name : value)) + '`.');
        }

        function resolveSpecialEventFn(stateName, fnName) {

            var
                state = stateStore[stateName],

                fallback,

                fallbackCount = 0;

            for (var property in state) {

                if (hasOwn(state, property)) {

                    if (property === fnName) {

                        return state[property];
                    }

                    if (property.toLowerCase() === fnName.toLowerCase()) {

                        fallback = state[property];

                        fallbackCount++;
                    }
                }
            }

            if (fallbackCount > 1) {

                throw new InvalidStateError('Stately.js: Ambiguous special event function: `' + fnName + '` in state `' + stateName + '`.');
            }

            return fallback;
        }

        function callSpecialEventFn(stateName, fnName, eventName, oldStateName, newStateName) {

            var fn = resolveSpecialEventFn(stateName, fnName);

            if (typeof fn === 'function') {

                fn.call(stateStore, eventName, oldStateName, newStateName);
            }
        }

        stateStore = {

            getMachineState: function getMachineState() {

                return currentState.name;
            },

            setMachineState: function setMachineState(nextState /*, eventName */) {

                var
                    eventName = arguments[1],

                    lastState = currentState,

                    targetState = nextState;

                if (typeof targetState === 'string') {

                    targetState = getStateByName(targetState);
                }

                if (!isStateObject(targetState)) {

                    throw invalidStateError(nextState);
                }

                if (lastState === targetState) {

                    return this;
                }

                callSpecialEventFn(lastState.name, 'onLeave', eventName, lastState.name, targetState.name);

                currentState = targetState;

                callSpecialEventFn(targetState.name, 'onEnter', eventName, lastState.name, targetState.name);

                return this;
            },

            getMachineEvents: function getMachineEvents() {

                var events = [];

                for (var property in currentState) {

                    if (hasOwn(currentState, property)
                        && typeof currentState[property] === 'function'
                        && !isSpecialEventName(property)) {

                        events.push(property);
                    }
                }

                return events;
            }

        };

        stateMachine = {

            getMachineState: stateStore.getMachineState,

            getMachineEvents: stateStore.getMachineEvents

        };

        transition = function transition(stateName, eventName, nextEvent) {

            return function event() {

                var args = [];
                for (var _i = 0; _i < arguments.length; _i++) {
                    args[_i] = arguments[_i];
                }

                var
                    nextState,

                    transitionTarget,

                    result,

                    eventValue = stateMachine;

                if (stateStore[stateName] !== currentState) {

                    if (nextEvent) {

                        eventValue = nextEvent.apply(stateStore, args);
                    }

                    return eventValue;
                }

                var oldStateName = currentState.name;

                callSpecialEventFn(oldStateName, 'onBefore' + eventName, eventName, oldStateName, oldStateName);

                callSpecialEventFn(oldStateName, 'onBefore', eventName, oldStateName, oldStateName);

                eventValue = stateStore[stateName][eventName].apply(stateStore, args);

                if (typeof eventValue === 'undefined' || eventValue === null) {

                    nextState = currentState;

                    eventValue = stateMachine;

                } else if (typeof eventValue === 'string') {

                    transitionTarget = eventValue;

                    nextState = getStateByName(eventValue);

                    eventValue = stateMachine;

                } else if (toString.call(eventValue) === '[object Array]') {

                    result = eventValue;

                    transitionTarget = result[0];

                    if (typeof result[0] === 'undefined' || result[0] === null) {

                        nextState = currentState;

                    } else if (typeof result[0] === 'string') {

                        nextState = getStateByName(result[0]);

                    } else {

                        nextState = result[0];
                    }

                    eventValue = typeof result[1] === 'undefined' ? stateMachine : result[1];

                } else if (toString.call(eventValue) === '[object Object]') {

                    nextState = (eventValue === stateStore ? currentState : eventValue);

                    transitionTarget = nextState;

                    eventValue = stateMachine;

                } else {

                    throw new InvalidStateError('Stately.js: Event `' + eventName + '` in state `' + stateName + '` returned an invalid transition value: `' + eventValue + '`.');
                }

                if (!isStateObject(nextState)) {

                    throw invalidStateError(transitionTarget);
                }

                callSpecialEventFn(oldStateName, 'onAfter' + eventName, eventName, oldStateName, nextState.name);

                callSpecialEventFn(oldStateName, 'onAfter', eventName, oldStateName, nextState.name);

                stateStore.setMachineState(nextState, eventName);

                return eventValue;
            };
        };

        var seenStateObjects = [];

        for (var stateName in statesObject) {

            if (hasOwn(statesObject, stateName)) {

                if (hasOwn(stateStore, stateName)) {

                    throw new InvalidStateError('Stately.js: Invalid state name: `' + stateName + '` is reserved.');
                }

                var stateObject = statesObject[stateName];

                if (toString.call(stateObject) !== '[object Object]') {

                    throw new InvalidStateError('Stately.js: Invalid state object: `' + stateName + '`.');
                }

                if (seenStateObjects.indexOf(stateObject) !== -1) {

                    throw new InvalidStateError('Stately.js: Duplicate state object: `' + stateName + '`.');
                }

                seenStateObjects.push(stateObject);

                stateStore[stateName] = stateObject;

                for (var eventName in stateObject) {

                    if (hasOwn(stateObject, eventName)) {

                        if (typeof stateObject[eventName] === 'string') {

                            stateObject[eventName] = (function (targetStateName) {

                                return function event() {

                                    return targetStateName;
                                };

                            })(stateObject[eventName]);
                        }

                        if (typeof stateObject[eventName] === 'function'
                            && !isSpecialEventName(eventName)) {

                            if (eventName === 'getMachineState'
                                || eventName === 'getMachineEvents'
                                || eventName === 'name') {

                                throw new InvalidStateError('Stately.js: Invalid event name: `' + eventName + '` is reserved.');
                            }

                            stateMachine[eventName] = transition(
                                stateName,
                                eventName,
                                hasOwn(stateMachine, eventName) ? stateMachine[eventName] : undefined
                            );
                        }
                    }
                }

                stateObject.name = stateName;

                if (stateObject.name !== stateName) {

                    throw new InvalidStateError('Stately.js: Unable to attach state name to state: `' + stateName + '`.');
                }

                if (!currentState) {

                    currentState = stateObject;
                }
            }
        }

        if (typeof initialStateName !== 'undefined') {

            if (!hasOwn(statesObject, initialStateName)) {

                throw new InvalidStateError('Stately.js: Invalid initial state: `' + initialStateName + '`.');
            }

            currentState = stateStore[initialStateName];
        }

        if (!currentState) {

            throw new InvalidStateError('Stately.js: Invalid initial state.');
        }

        return stateMachine;
    }

    Stately.machine = function machine(statesObject, initialStateName) {
        return new Stately(statesObject, initialStateName);
    };

    Stately.InvalidStateError = InvalidStateError;

    return Stately;

});
