const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Consume the sibling package straight from source rather than a build step:
// Metro/Babel already transpile its TS/TSX, and it keeps edits live-reloading.
const packageRoot = path.resolve(__dirname, '../bot-avatars-native');
// The web package (the rig, the colours, the form bake) is a `file:` dependency:
// npm symlinks it, and Metro has to watch the real folder behind the link.
const webRoot = path.resolve(__dirname, '../../..');

config.watchFolders = [packageRoot, webRoot];

const escape = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The packages' own node_modules exist only for their typecheck. Metro must
// never resolve a dependency from there: a second copy of Reanimated /
// Worklets / Skia JS against the app's single native build breaks at startup.
config.resolver.blockList = [
  new RegExp(`${escape(packageRoot)}/node_modules/.*`),
  new RegExp(`${escape(webRoot)}/node_modules/.*`),
];

config.resolver.extraNodeModules = {
  'bot-avatars-native': path.resolve(packageRoot, 'src'),
  'bot-avatars': webRoot,
  // The package's peer deps must resolve to the app's single copy, or Skia and
  // Reanimated end up duplicated and their native bindings break.
  react: path.resolve(__dirname, 'node_modules/react'),
  'react-native': path.resolve(__dirname, 'node_modules/react-native'),
  '@shopify/react-native-skia': path.resolve(__dirname, 'node_modules/@shopify/react-native-skia'),
  'react-native-reanimated': path.resolve(__dirname, 'node_modules/react-native-reanimated'),
  'react-native-worklets': path.resolve(__dirname, 'node_modules/react-native-worklets'),
};

module.exports = config;
