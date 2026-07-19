// Giả lập module 'url' của Node.js để lừa plugin Babel transform-import-meta
module.exports = {
  pathToFileURL: function(path) {
    return {
      href: 'file://' + path,
      toString: function() { return 'file://' + path; }
    };
  }
};
