// Expo config plugin: puts the magnet model (Magnet.mfxl, downloaded from
// libraries.dev under the Libraries.dev Model License) into the app: the iOS
// app target's resources and Android's assets, where MagnetKit loads it.
//
//   "plugins": [["react-native-magnetkit", { "model": "./assets/Magnet.mfxl" }]]

const fs = require("fs");
const path = require("path");
const { withDangerousMod, withXcodeProject, IOSConfig } = require("expo/config-plugins");

const FILE = "Magnet.mfxl";

function modelPath(config, props) {
  const p = path.resolve(config._internal?.projectRoot ?? process.cwd(), props?.model ?? `./assets/${FILE}`);
  if (!fs.existsSync(p)) {
    throw new Error(
      `react-native-magnetkit: no model at ${p}. Download Magnet.mfxl from https://libraries.dev/magnetic ` +
        `and point the plugin at it: ["react-native-magnetkit", { "model": "./assets/Magnet.mfxl" }].`,
    );
  }
  return p;
}

function withMagnetModelAndroid(config, props) {
  return withDangerousMod(config, [
    "android",
    (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, "app", "src", "main", "assets");
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(modelPath(c, props), path.join(dir, FILE));
      return c;
    },
  ]);
}

function withMagnetModelIos(config, props) {
  config = withDangerousMod(config, [
    "ios",
    (c) => {
      const name = IOSConfig.XcodeUtils.getProjectName(c.modRequest.projectRoot);
      fs.copyFileSync(modelPath(c, props), path.join(c.modRequest.platformProjectRoot, name, FILE));
      return c;
    },
  ]);
  return withXcodeProject(config, (c) => {
    const project = c.modResults;
    const name = IOSConfig.XcodeUtils.getProjectName(c.modRequest.projectRoot);
    const filepath = path.join(name, FILE);
    if (!project.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addResourceFileToGroup({ filepath, groupName: name, project, isBuildFile: true, verbose: false });
    }
    return c;
  });
}

module.exports = function withMagnetKit(config, props = {}) {
  config = withMagnetModelAndroid(config, props);
  config = withMagnetModelIos(config, props);
  return config;
};
