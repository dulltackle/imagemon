# 移动端验证独立于 Skill 发布验证

根 `npm run verify` 继续服务现有 CLI、共享核心和 Skill 发布前验证，可以包含共享核心测试，但不运行 Expo 原生构建，也不依赖 iOS 或 Android SDK。移动端应用提供独立验证脚本，例如 `mobile:verify`，CI 可拆分为核心/Skill 验证与移动端验证两个 job，避免移动端环境问题阻塞 Skill 发布流程。
