// Giả lập module 'crypto' của Node.js để lừa Metro khi biên dịch tĩnh olm_legacy.js
module.exports = {
  randomBytes: function (size) {
    const arr = new Uint8Array(size);
    if (global.crypto && global.crypto.getRandomValues) {
      global.crypto.getRandomValues(arr);
    }
    return typeof global.Buffer !== 'undefined' ? global.Buffer.from(arr) : arr;
  },
  randomFillSync: function (buffer) {
    if (global.crypto && global.crypto.getRandomValues) {
      global.crypto.getRandomValues(buffer);
    }
    return buffer;
  }
};
