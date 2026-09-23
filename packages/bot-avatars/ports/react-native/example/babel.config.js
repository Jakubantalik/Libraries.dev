module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4: the worklet transform lives in react-native-worklets. Must stay last.
    plugins: ['react-native-worklets/plugin'],
  };
};
