// AVA tutorial: https://itenium.be/blog/javascript/ava-tutorial/
const test = require('ava');
const {FSM, FSMError, ERROR, EMPTY, runFSM, rerunFSM, makeStates, logTransitions} = require('../lib/fsm.js');

test('advance leads to next state', async t => {
  const states = makeStates("A", "B");
  const fsm = new FSM(states.A);
  fsm.addTransition(states.A, {transitionFn: _ => states.B});
  await fsm.advance();
  t.is(fsm.currentState, states.B, "FSM advances to state B");
});

test('pre- and post- transition callbacks are made', async t => {
  t.plan(3);
  const states = makeStates("A", "B");
  const fsm = new FSM(states.A);
  fsm.on("pretransition", ({from}) => t.is(from, states.A, "pre-transition callback invoked")),
  fsm.on("posttransition", ({from, to}) => {
          t.is(from, states.A, "post-transition callback invoked 1/2");
          t.is(to, states.B, "post-transition callback invoked 2/2");
  });
  fsm.addTransition(states.A, {nextState: states.B});
  await fsm.advance();
});

test('pretransition event handler errors leave FSM in consistent pre-transition state', async t => {
    t.plan(3);
    const states = makeStates("A", "B");
    const fsm = new FSM(states.A);
    fsm.on("pretransition", ({from}) => {
        throw new Error("pretransition exception");
    }),
    fsm.addTransition(states.A, {nextState: states.B});
    await t.throwsAsync(async () => {
        await fsm.advance();
    }, {instanceOf: Error, message: "pretransition exception"});
    t.is(fsm.inTransition, false, "FSM is not in transition");
    t.is(fsm.currentState, "A", "FSM remains in pretransition state");
});

test('attempting to advance() while in transition causes error', async t => {
    t.plan(1);
    const states = makeStates("A", "B", "C");
    const fsm = new FSM(states.A);
    let continueTransition;
    fsm.addTransition(states.A, {nextState: states.B, transitionFn: () => new Promise((resolve, reject) => {
        continueTransition = resolve;
    })});
    fsm.addTransition(states.B, {nextState: states.C});
    // first advance still OK.
    fsm.advance();
    await t.throwsAsync(async () => await fsm.advance(), {instanceOf: FSMError, message: "cannot advance while in transition"});
});

test('posttransition event handler errors leave FSM in consistent post-transition state', async t => {
    t.plan(3);
    const states = makeStates("A", "B");
    const fsm = new FSM(states.A);
    fsm.on("posttransition", ({from, to}) => {
        throw new Error("posttransition exception");
    }),
    fsm.addTransition(states.A, {nextState: states.B});
    await t.throwsAsync(async () => {
        await fsm.advance();
    }, {instanceOf: Error, message: "posttransition exception"});
    t.is(fsm.inTransition, false, "FSM is not in transition");
    t.is(fsm.currentState, "B", "FSM remains in posttransition state");
});

test('posttransition event handler invoked if transition to same state', async t => {
    t.plan(2);
    const states = makeStates("A", "B");
    const fsm = new FSM(states.A);
    fsm.on("posttransition", ({from, to}) => {
        t.is(from, states.A, "post-transition callback invoked 1/2");
        t.is(to, states.A, "post-transition callback invoked 2/2");
    });
    fsm.addTransition(states.A, {nextState: states.A});
    await fsm.advance();
});

test('transition functions can be async', async t => {
  const states = makeStates("A", "B");
  const fsm = new FSM(states.A);
  fsm.addTransition(states.A, {transitionFn: () => new Promise((resolve, reject) => resolve(states.B))});
  await fsm.advance();
  t.is(fsm.currentState, states.B, "FSM advances to state B");
});

test('nextState overrides transitionFn return value', async t => {
  const states = makeStates("A", "B", "C");
  const fsm = new FSM(states.A);
  fsm.addTransition(states.A, {nextState: states.C, transitionFn: () => new Promise((resolve, reject) => resolve(states.B))});
  await fsm.advance();
  t.is(fsm.currentState, states.C, "FSM advances to state B");
});


test('first of multiple transitions used', async t => {
  const states = makeStates("A", "B", "C");
  const fsm = new FSM(states.A);
  fsm.addTransition(states.A, {transitionFn: () => new Promise((resolve, reject) => resolve(states.B))});
  fsm.addTransition(states.A, {transitionFn: () => new Promise((resolve, reject) => resolve(states.C))});
  await fsm.advance();
  t.is(fsm.currentState, states.B, "FSM advances to state B");
});

test('first of multiple transitions used (prepend)', async t => {
  const states = makeStates("A", "B", "C");
  const fsm = new FSM(states.A);
  fsm.addTransition(states.A, {transitionFn: () => new Promise((resolve, reject) => resolve(states.B))});
  fsm.addTransition(states.A, {transitionFn: () => new Promise((resolve, reject) => resolve(states.C))}, true);
  await fsm.advance();
  t.is(fsm.currentState, states.C, "FSM advances to state C");
});


test('first of multiple transitions used which evaluates to a valid next state', async t => {
  const states = makeStates("A", "B", "C");
  const fsm = new FSM(states.A);
  fsm.addTransition(states.A, {transitionFn: () => new Promise((resolve, reject) => resolve(null))});
  fsm.addTransition(states.A, {transitionFn: () => new Promise((resolve, reject) => resolve(states.C))});
  await fsm.advance();
  t.is(fsm.currentState, states.C, "FSM advances to state C");
});

test('failure to evaluate transitionFn leads to error state (alternative transitions ignored)', async t => {

  const states = makeStates("A", "B", "C", "ERR1", "ERR2");
  const fsm = new FSM(states.A);
  fsm.addTransition(states.A, {transitionFn: () => {throw new Error("err");}, nextState: states.B, errorState: states.ERR1});
  fsm.addTransition(states.A, {transitionFn: () => new Promise((resolve, reject) => resolve(states.C)), nextState: states.C, errorState: states.ERR2});
  await fsm.advance();
  t.is(fsm.currentState, states.ERR1, "FSM advances to state ERR1");
});


test('advance throws error in no next state', async t => {
    await t.throwsAsync(async () => {
        const fsm = new FSM();
        await fsm.advance();
    }, {instanceOf: FSMError, message: 'No valid transition from state EMPTY'});
});

test('advance to errors state if exception occurs in transition fn', async t => {
  const states = makeStates("A", "B");
  const fsm = new FSM(states.A);
  fsm.addTransition(states.A, {transitionFn: () => {throw new Error("err");}, errorState: states.B});
  [state, e] = await fsm.advance();
  t.is(state, states.B, "FSM advances to state B");
  t.true(e instanceof Error);
});

test('transition input and output pass through as expected when nextState specified', async t => {
  const states = makeStates("A", "B");
  const fsm = new FSM(states.A);
  fsm.addTransition(states.A, {transitionFn: (...args) => [...args], nextState: states.B});
  [state, ...result] = await fsm.advance(1,2,3);
  t.is(state, states.B, "FSM advances to state B");
  t.deepEqual(result, [1,2,3], "transition output received");
});

test('transition input and output pass through as expected when nextState returned by transitionFn', async t => {
  const states = makeStates("A", "B");
  const fsm = new FSM(states.A);
  fsm.addTransition(states.A, {transitionFn: (...args) => [states.B, ...args]});
  [state, ...result] = await fsm.advance(1,2,3);
  t.is(state, states.B, "FSM advances to state B");
  t.deepEqual(result, [1,2,3], "transition output received");
});

test('transitionLog', async t => {
  const states = makeStates("A", "B");
  const fsm = new FSM(states.A);
  fsm.addTransition(states.A, {transitionFn: (...args) => [states.B, ...(args.map(x => x+10))]});
  const transitionLog = logTransitions(fsm); 
  [state, ...result] = await fsm.advance(1,2,3);
  t.is(transitionLog.length, 1, "single transition");
  t.is(transitionLog[0].from, states.A);
  t.is(transitionLog[0].to, states.B);
  t.deepEqual(transitionLog[0].input, [1,2,3]);
  t.deepEqual(transitionLog[0].output, [11,12,13]);
});

test('runFSM advances until stopping state reached', async t => {
  const states = makeStates("A", "B", "C");
  const fsm = new FSM(states.A);
  const mkTransitionFn = c => ((str) => str + c);
  fsm.addTransition(states.A, {nextState: states.B, transitionFn: mkTransitionFn("->b")});
  fsm.addTransition(states.B, {nextState: states.C, transitionFn: mkTransitionFn("->c")});
  [state, output] = await runFSM(fsm, [states.C], "a");
  t.is(state, states.C, "FSM advances to state C");
  t.is(output, "a->b->c");
});

test('rerunFSM continues with correct input arguments', async t => {
  const states = makeStates("START", "EVEN", "ODD", "FINISHED");
  const parity = (x) => x % 2 === 0 ? states.EVEN : states.ODD;
  const makeFSM = (max) => {
    const inc = (x) => {
      if (x >= max) return [states.FINISHED, x];
      x += 1
      return [parity(x), x];
    };
    const fsm = new FSM(states.START);
    fsm.addTransition(states.START, {transitionFn: (x) => [parity(x), x]});
    fsm.addTransition(states.EVEN, {transitionFn: inc});
    fsm.addTransition(states.ODD, {transitionFn: inc});
    return fsm;
  };
  // run first FSM counting from 0 to 4
  let fsm = makeFSM(4);
  const transitionLog = logTransitions(fsm); 
  [state, output] = await runFSM(fsm, [states.FINISHED], 0);
  t.is(state, states.FINISHED, "FSM finished on states.FINISHED");
  t.is(output, 4, "counting stops at 4");
  t.is(transitionLog.length, 6 /* max + 2 */);
  // rerun FSM starting off at last odd number (3) counting to 5.
  fsm = makeFSM(5);
  const transitionLog2 = logTransitions(fsm);
  [state, output] = await rerunFSM(fsm, states.ODD, [states.FINISHED], transitionLog);
  t.is(state, states.FINISHED, "FSM finished on states.FINISHED");
  t.is(output, 5, "counting stops at 5");
  // transactionLog2 is  ODD(3) -> EVEN(4) -> ODD(5) -> FINISHED
  t.is(transitionLog2.length, 3);
  t.deepEqual(transitionLog2.map(x => x.input[0]), [3,4,5], "transition log inputs match");
  t.deepEqual(transitionLog2.map(x => x.from), [states.ODD, states.EVEN, states.ODD], "transition log from states match");
});

