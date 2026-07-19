// index.js (Nằm ngoài cùng thư mục dự án)

// 1. Định nghĩa DOMException ngay mili-giây đầu tiên
if (typeof global.DOMException === 'undefined' || typeof globalThis.DOMException === 'undefined') {
  class DOMExceptionPolyfill extends Error {
    constructor(m, n) {
      super(m);
      this.name = n || 'DOMException';
      this.code = 0;
    }
  }
  global.DOMException = DOMExceptionPolyfill;
  globalThis.DOMException = DOMExceptionPolyfill;
}

// 🌟 THÊM ĐOẠN NÀY: Giả lập biến môi trường để triệt tiêu lỗi của Babel plugin trên Hermes
global.__filename = 'index.js';
global.__dirname = '/';

// 🌟 THAY THẾ ĐOẠN WEBASSEMBLY CŨ THÀNH ĐOẠN GIẢ LẬP AN TOÀN NÀY:
const dummyWebAssembly = {
  instantiate: async () => ({ instance: {}, module: {} }),
  instantiateStreaming: async () => ({ instance: {}, module: {} }),
  compile: async () => ({}),
  compileStreaming: async () => ({}),
  validate: () => true,
  Instance: class {},
  Module: class {},
  Table: class { grow() { return 0; } get() { return null; } set() {} get length() { return 0; } },
  Memory: class { grow() { return 0; } get buffer() { return new ArrayBuffer(0); } },
};

global.WebAssembly = dummyWebAssembly;
globalThis.WebAssembly = dummyWebAssembly;

// Polyfill giả (dummy) cho FinalizationRegistry (do Hermes chưa hỗ trợ hoàn thiện API này)
if (typeof global.FinalizationRegistry === 'undefined') {
  global.FinalizationRegistry = class FinalizationRegistry {
    constructor(cleanupCallback) {}
    register(target, heldValue, unregisterToken) {}
    unregister(unregisterToken) {}
  };
  globalThis.FinalizationRegistry = global.FinalizationRegistry;
}

// 🌟 POLYFILL WEBRTC CHO MATRIX JS SDK HOẠT ĐỘNG TRÊN REACT NATIVE
import { registerGlobals } from 'react-native-webrtc';

// Đăng ký toàn bộ biến môi trường WebRTC chuẩn (window.RTCPeerConnection, navigator.mediaDevices...)
registerGlobals();

if (!global.window) global.window = global;
if (!global.document) {
  global.document = {
    createElement: (tag) => ({ play: async () => {}, pause: () => {}, srcObject: null, setAttribute: () => {}, removeAttribute: () => {}, addEventListener: () => {}, removeEventListener: () => {} })
  };
}

// 🌟 POLYFILL AUDIO CONTEXT: Đánh lừa Matrix SDK để không bị crash khi gọi Web Audio API
class DummyAudioContext {
  constructor() { this.state = 'running'; }
  createMediaStreamSource() { return { connect: () => {} }; }
  createAnalyser() { return { connect: () => {}, disconnect: () => {}, fftSize: 2048, frequencyBinCount: 1024, getByteTimeDomainData: () => {} }; }
  createGain() { return { gain: { value: 1 }, connect: () => {}, disconnect: () => {} }; }
  createScriptProcessor() { return { connect: () => {}, disconnect: () => {}, onaudioprocess: null }; }
  createBiquadFilter() { return { connect: () => {}, disconnect: () => {} }; }
  createMediaStreamDestination() { return { stream: {}, connect: () => {}, disconnect: () => {} }; }
  close() { return Promise.resolve(); }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
}
global.AudioContext = DummyAudioContext;
global.window.AudioContext = DummyAudioContext;
global.window.webkitAudioContext = DummyAudioContext;

// 2. Nạp các polyfill hệ thống bằng require để tránh bị Babel nhấc lên đầu
require('react-native-get-random-values');

global.Buffer = require('buffer').Buffer;

const TextEncodingPolyfill = require('text-encoding');
Object.assign(global, { 
  TextEncoder: TextEncodingPolyfill.TextEncoder, 
  TextDecoder: TextEncodingPolyfill.TextDecoder 
});

require('fake-indexeddb/auto');

// 3. Đã xoá việc gán global.Olm bằng matrix-sdk-crypto-js.
// Engine mã hoá E2EE sẽ tự động lấy bộ olm_legacy thuần JS được import ở bên trong matrix.ts
// Việc ép dùng bản WASM rỗng (dummyWebAssembly) trước đây chính là nguyên nhân làm hỏng logic giải mã.

// 4. Cuối cùng mới gọi file giao diện chính của bạn chạy
import { registerRootComponent } from 'expo';
import 'react-native-gesture-handler';
import App from './src/App';

registerRootComponent(App);
