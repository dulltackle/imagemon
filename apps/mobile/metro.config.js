const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");
const path = require("path");

const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, "../..");
const appNodeModules = path.resolve(__dirname, "node_modules");
const workspaceNodeModules = path.resolve(workspaceRoot, "node_modules");
const domExceptionPolyfill = path.resolve(
  __dirname,
  "src/polyfills/dom-exception.js",
);
const getDefaultPolyfills = config.serializer.getPolyfills;

config.resolver.assetExts.push("wasm");
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [appNodeModules, workspaceNodeModules];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@expo/metro-runtime": path.join(appNodeModules, "@expo/metro-runtime"),
  "@expo/vector-icons": path.join(appNodeModules, "@expo/vector-icons"),
  expo: path.join(appNodeModules, "expo"),
  "expo-font": path.join(appNodeModules, "expo-font"),
  "expo-router": path.join(appNodeModules, "expo-router"),
  react: path.join(appNodeModules, "react"),
  "react-dom": path.join(appNodeModules, "react-dom"),
  "react-native": path.join(appNodeModules, "react-native"),
  "react-native-safe-area-context": path.join(
    appNodeModules,
    "react-native-safe-area-context",
  ),
  "react-native-screens": path.join(appNodeModules, "react-native-screens"),
};
config.serializer.getPolyfills = (options) => [
  domExceptionPolyfill,
  ...getDefaultPolyfills(options).filter(
    (polyfill) => polyfill !== domExceptionPolyfill,
  ),
];

module.exports = withNativewind(config, {
  inlineVariables: false,
  globalClassNamePolyfill: false,
});
