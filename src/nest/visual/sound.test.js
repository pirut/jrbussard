/* A stand-in AudioContext: every node is a chainable stub, and the context
   counts how often it is built, suspended and resumed. */
const stub = () => {
  const fn = () => stub();
  return new Proxy(fn, { get: (_, k) => (k === 'then' ? undefined : stub()), set: () => true, apply: () => stub() });
};
let built;
let suspended;
let resumed;
class FakeAudioContext {
  constructor() {
    built += 1;
    this.currentTime = 0;
    this.state = 'running';
    this.destination = stub();
  }
  resume() { resumed += 1; }
  suspend() { suspended += 1; }
}
for (const name of ['createGain', 'createDynamicsCompressor', 'createOscillator', 'createBiquadFilter']) {
  FakeAudioContext.prototype[name] = () => stub();
}

let createVoice;
beforeEach(() => {
  // sound.js keeps its AudioContext at module level; start each test clean
  jest.resetModules();
  ({ createVoice } = require('./sound'));
  built = 0;
  suspended = 0;
  resumed = 0;
  window.AudioContext = FakeAudioContext;
});
afterEach(() => {
  delete window.AudioContext;
});

test('every voice shares one AudioContext', () => {
  const voices = [createVoice(), createVoice({ stage: 'elder' }), createVoice({ pitch: 0.9 })];
  voices.forEach((v) => expect(v.enable()).toBe(true));
  voices.forEach((v) => v.chirp());
  expect(built).toBe(1);
});

test('the shared context sleeps only when the last voice is disabled', () => {
  const a = createVoice();
  const b = createVoice();
  a.enable();
  b.enable();
  a.disable();
  expect(suspended).toBe(0);
  b.disable();
  expect(suspended).toBe(1);
  expect(resumed).toBe(2);
});

test('destroy silences a voice, keeps the shared context, and enable() brings it back', () => {
  const a = createVoice();
  const b = createVoice();
  a.enable();
  b.enable();
  a.purr(true);
  a.destroy();
  expect(a.enabled).toBe(false);
  expect(() => a.chirp()).not.toThrow();
  expect(built).toBe(1);
  expect(a.enable()).toBe(true);
  expect(() => a.coo()).not.toThrow();
  expect(built).toBe(1);
});

test('without WebAudio the voice stays silent instead of throwing', () => {
  delete window.AudioContext;
  const v = createVoice();
  expect(v.enable()).toBe(false);
  expect(() => { v.chirp(); v.purr(true); v.destroy(); }).not.toThrow();
});
