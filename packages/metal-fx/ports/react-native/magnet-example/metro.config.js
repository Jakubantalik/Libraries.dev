const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// The kit is linked from the sibling folder (file:../magnetkit-native).
const packageRoot = path.resolve(__dirname, '../magnetkit-native');
config.watchFolders = [packageRoot];

// Its node_modules, if any, exist only for its typecheck: React and React
// Native must resolve to the app's single copy.
config.resolver.blockList = [new RegExp(`${packageRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/node_modules/.*`)];
config.resolver.extraNodeModules = {
  react: path.resolve(__dirname, 'node_modules/react'),
  'react-native': path.resolve(__dirname, 'node_modules/react-native'),
  expo: path.resolve(__dirname, 'node_modules/expo'),
};

module.exports = config;
