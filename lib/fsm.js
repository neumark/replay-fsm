const EMPTY = Symbol("EMPTY");
const ERROR = Symbol("ERROR");

const getLabel = state => state.description || state + "";

const makeStates = (...states) => states.reduce((acc, state) => {
    acc[getLabel(state)] = state;
    return acc;
}, {});

const EVENTS = makeStates('pretransition', 'posttransition');

// based on: https://medium.com/@xjamundx/custom-javascript-errors-in-es6-aa891b173f87
class FSMError extends Error {
    constructor(...args) {
        super(...args)
        Error.captureStackTrace(this, FSMError)
    }
}

// invokes a sync or async function and always return a promise
const invokePromiseFn = (fn, ...args) => {
    try {
        return Promise.resolve(fn.apply(null, args));
    } catch (e) {
        return Promise.reject(e);
    }
};

const saveToHashList = (hashList, key, value, prepend=false) => {
    hashList[key] = hashList[key] || [];
    hashList[key][prepend ? 'unshift' : 'push'](value);
    return hashList;
};

// Invoke event handlers registered for an event, returns promise fulfilled when they all complete.
const callbackHashList = (hashList, eventName, ...args) => Promise.all((hashList[eventName] || []).map(fn => invokePromiseFn(fn, ...args)));

// unlike python, transitionLog's default value will always be a new empty list
const logTransitions = (fsm, transitionLog = []) => {
    fsm.on(EVENTS.posttransition, transitionData => transitionLog.push({time: new Date(), ...transitionData}));
    return transitionLog;
};

// keeps running the FSM until a stopping state is reached
const runFSM = async (fsm, finalStates, ...args) => {
    let nextState, result;
    finalStates = Array.isArray(finalStates) ? finalStates : [finalStates, ERROR];
    while (!finalStates.includes(nextState)) {
        result = [nextState, ...args] = await fsm.advance(...args);
    }
    return result;
};

const rerunFSM = (fsm, initialState, finalStates, transitionLog = []) => {
    // get the transition output for the last successful arrival to initialState
    const args = (transitionLog.slice().reverse().filter(t => t.to === initialState)[0] || {}).output || [];
    fsm.currentState = initialState;
    return runFSM(fsm, finalStates, ...args);
};

class FSM {
    constructor (initialState = EMPTY) {
        this.currentState = initialState;
        this.callbacks = {};
        this.validTransitions = {}
        this.inTransition = false;
    }

    on(eventName, callback) {
        saveToHashList(this.callbacks, eventName, callback);
    }

    async advance(...transitionInput) {
        if (this.inTransition) {
            throw new FSMError("cannot advance while in transition");
        }
        this.inTransition = true;
        try {
            await callbackHashList(this.callbacks, EVENTS.pretransition, {
                from: this.currentState,
                input: transitionInput
            });
        } catch (e) {
            this.inTransition = false;
            throw e;
        }
        let nextState, attemptedTransition, attemptResult, transitionOutput = [];
        if (this.validTransitions.hasOwnProperty(this.currentState)) {
            for (let transitionIndex = 0;
                !nextState && transitionIndex < this.validTransitions[this.currentState].length;
                transitionIndex++) {
                attemptedTransition = this.validTransitions[this.currentState][transitionIndex];
                transitionOutput = [];
                try {
                    // if the transition defines nextState, let's use it!
                    nextState = attemptedTransition.nextState;
                    // if the transition has a transitionFn, let's run it!
                    if (attemptedTransition.transitionFn) {
                        attemptResult = await invokePromiseFn(attemptedTransition.transitionFn, ...transitionInput);
                        if (attemptResult) {
                            if (Array.isArray(attemptResult)) {
                                if (!nextState) {
                                    // transitionFunction returned an array and transition had no specified nextState
                                    [nextState, ...transitionOutput] = attemptResult;
                                } else {
                                    // transitionFunction returned an array and transition had a specified nextState
                                    transitionOutput = attemptResult;
                                }
                            } else {
                                if (!nextState) {
                                    // transitionFunction returned a non-array and transition had no specified nextState
                                    nextState = attemptResult;
                                } else {
                                    // transitionFunction returned a non-array and transition had a specified nextState
                                    transitionOutput = [attemptResult];
                                }
                            } 
                        }
                    }
                    // if nextState still not defined,  let's try next transition from starting state in the next iteration
                } catch (e) {
                    // promise rejection / exception in transitionFn
                    nextState = attemptedTransition.errorState || ERROR;
                    transitionOutput = [e];
                }
            }
        } 
        if (!nextState) {
            // no valid state starting from current state
            throw new FSMError(`No valid transition from state ${getLabel(this.currentState)}`);
        }
        const prevState = this.currentState;
        this.currentState = nextState;
        // try{} because event handlers can throw their own exceptions
        try {
            await callbackHashList(this.callbacks, EVENTS.posttransition, {
                from: prevState,
                to: nextState,
                transition: attemptedTransition,
                input: transitionInput,
                output: transitionOutput});
            return [this.currentState, ...transitionOutput];
        } finally {
            // take FSM out of 'inTransition' state even if an event handler throw exception
            this.inTransition = false;
        }
    }
    
    /* addTransition options:
     * startingState - FSM state from which the transition is applicable
     * errorState - the state to transition to if any error occurs during evaluation of transitionFn
     * nextState - specifies the nextState. If transitionFn is specified, it will still be called during
     *             the transition, but unless there is an exception / promise rejection, nextState will
     *             be the state following the transition regardless of transitionFn's return value.
     * transitionFn - Transition function. If nextState is specified, is during the transition to nextState.
     *             When nextState is not defined, transitionFn's return value specifies the next state, thus
     *             it's value must be one of the following:
     *             * A falsey value, meaning the transition is not applicable.
     *               The FSM will then try the next transition from the starting state.
     *             * A single string specifying the next state.
     *             * An array of [nextState, ...transitionOutput] form.
     *             Promise rejection / exceptions during transitionFn will lead to errorState, which by
     *             default is ERROR defined in this module.
     * prepend - when true, the new transition has the highest priority for all transitions from startingState.
     *           by default, prepend is false and new transitions have lower priority than those previously registered.
     */
    addTransition (startingState, {transitionFn, nextState, errorState}, prepend) {
        if (!transitionFn && !nextState) {
            throw new FSMError(`cannot add transition from ${getLabel(startingState)} without a transitionFn or nextState defined`);
        }
        saveToHashList(this.validTransitions, startingState, {transitionFn, nextState, errorState}, prepend);
    }
};

module.exports = {EMPTY, ERROR, FSM, FSMError, runFSM, rerunFSM, logTransitions, makeStates};
