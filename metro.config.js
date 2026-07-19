const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Cấu hình react-native-svg-transformer
const { transformer, resolver } = config;
config.transformer = {
  ...transformer,
  babelTransformerPath: require.resolve("react-native-svg-transformer/expo")
};
config.resolver = {
  ...resolver,
  assetExts: resolver.assetExts.filter((ext) => ext !== "svg"),
  sourceExts: [...resolver.sourceExts, "svg"]
};

// 1. MOCK HOÀN TOÀN CÁC THƯ VIỆN NODE.JS ĐỂ CHẶN ĐỨNG LỖI BIÊN DỊCH
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  url: path.resolve(__dirname, 'mock-url.js'),
  path: path.resolve(__dirname, 'mock-url.js'), // Lừa Metro khi gọi require('path')
  fs: path.resolve(__dirname, 'mock-url.js'),   // Lừa Metro khi gọi require('fs')
  crypto: path.resolve(__dirname, 'mock-crypto.js'), // Bypass lỗi Node.js crypto
  util: path.resolve(__dirname, 'mock-util.js'), // Bypass lỗi require('util')
};

// 2. ÉP BẺ HƯỚNG PHÂN GIẢI MODULE TRỐNG
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Chỉ chặn bản WASM và bản Crypto-JS, tuyệt đối không chặn olm_legacy
  if (
    moduleName.includes('@matrix-org/matrix-sdk-crypto-wasm') || 
    moduleName.includes('@matrix-org/matrix-sdk-crypto-js')
  ) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'mock-url.js'), // Trả về file rỗng để nuốt lỗi sập
    };
  }

  // Chặn đứng Metro văng lỗi khi quét thấy lệnh require('crypto') trong olm.js
  if (moduleName === 'crypto') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'mock-crypto.js'),
    };
  }

  // Chặn lỗi thiếu module @giphy/react-native-sdk của jitsi
  if (moduleName === '@giphy/react-native-sdk') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'src/mocks/giphy.js'),
    };
  }

  // Bypass lỗi quét tĩnh khi matrix-js-sdk tìm TextEncoder trong util
  if (moduleName === 'util') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'mock-util.js'),
    };
  }
  
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;