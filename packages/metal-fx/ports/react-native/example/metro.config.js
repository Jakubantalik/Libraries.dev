const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Consume the sibling package straight from source rather than a build step:
// Metro/Babel already transpile its TS/TSX, and it keeps edits live-reloading.
const packageRoot = path.resolve(__dirname, '../metal-fx-native');

config.watchFolders = [packageRoot];

config.resolver.extraNodeModules = {
  'metal-fx-native': path.resolve(packageRoot, 'src'),
  // The package's peer deps must resolve to the app's single copy, or Skia and
  // Reanimated end up duplicated and their native bindings break.
  react: path.resolve(__dirname, 'node_modules/react'),
  'react-native': path.resolve(__dirname, 'node_modules/react-native'),
  '@shopify/react-native-skia': path.resolve(__dirname, 'node_modules/@shopify/react-native-skia'),
  'react-native-reanimated': path.resolve(__dirname, 'node_modules/react-native-reanimated'),
  'react-native-worklets': path.resolve(__dirname, 'node_modules/react-native-worklets'),
};

module.exports = config;
