# 手机端从 Expo managed workflow 起步

手机端首版从 Expo managed workflow 起步，优先使用 Expo 生态提供的 SQLite、SecureStore、文件、相册、分享等能力。需要原生配置时优先通过 `app.config.ts` 和 config plugins 管理；首版不把手写原生模块或长期维护 `ios/`、`android/` 手写项目作为主要实施路径。
