// Giả lập module 'util' của Node.js để triệt tiêu lỗi load TextEncoder của matrix-js-sdk
module.exports = {
  TextEncoder: global.TextEncoder,
  TextDecoder: global.TextDecoder,
  inspect: function(obj) { return String(obj); },
  promisify: function(fn) {
    return function (...args) {
      return new Promise((resolve, reject) => {
        fn(...args, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    };
  },
  inherits: function(ctor, superCtor) {
    ctor.super_ = superCtor;
    Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
  }
};
