const JSDOMEnvironment = require('jest-environment-jsdom').default;

// jsdom ships none of the Web platform APIs below, but react-router v7 in data
// mode constructs a `Request` for every navigation and the Ask screen reads a
// streamed `fetch()` response body. Node (22+) implements all of them to spec,
// so copy its versions onto the jsdom global where jsdom left a gap. Cheaper
// and more faithful than a userland polyfill.
const FROM_NODE = [
  'Request',
  'Response',
  'Headers',
  'ReadableStream',
  'WritableStream',
  'TransformStream',
  'TextEncoder',
  'TextDecoder',
  'structuredClone',
];

// NB: deliberately not MessageChannel/MessagePort - React's scheduler grabs
// them for task scheduling and Node's MessagePort keeps the event loop alive,
// which stops Jest exiting. The scheduler falls back to setTimeout without it.

// jsdom *does* ship these two, but its `AbortSignal` is a different class from
// Node's. The Ask screen passes `new AbortController().signal` to `fetch()`,
// whose `Request` constructor (copied from Node above) does an `instanceof
// AbortSignal` check against *Node's* class and throws "Expected signal to be
// an instance of AbortSignal". Force Node's versions so the signal and the
// fetch that receives it agree.
const OVERRIDE_FROM_NODE = ['AbortController', 'AbortSignal'];

class ClientTestEnvironment extends JSDOMEnvironment {
  constructor(config, context) {
    super(config, context);
    for (const key of FROM_NODE) {
      if (this.global[key] === undefined && globalThis[key] !== undefined) {
        this.global[key] = globalThis[key];
      }
    }
    for (const key of OVERRIDE_FROM_NODE) {
      if (globalThis[key] !== undefined) {
        this.global[key] = globalThis[key];
      }
    }
  }
}

module.exports = ClientTestEnvironment;
