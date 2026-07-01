module.exports = function configureBabel(api) {
  api.cache(true);

  const expoPackagePath = require.resolve("expo/package.json");
  const expoBabelPreset = require.resolve("babel-preset-expo", {
    paths: [require("path").dirname(expoPackagePath)],
  });

  return {
    presets: [
      [
        expoBabelPreset,
        {
          // iOS Expo Go 的 Hermes 仍由 Metro 请求 hermes-stable profile；
          // 这里显式要求 Babel 做保守降级，避免启动阶段执行未降级的 class/private 语法。
          native: { unstable_transformProfile: "default" },
        },
      ],
    ],
  };
};
