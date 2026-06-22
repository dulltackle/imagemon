# 随手机端落地引入 npm workspaces

当前仓库在创建 `apps/mobile` 和共享核心目录时引入 npm workspaces，而不是在纯规划阶段提前修改根 `package.json`。workspaces 用于表达移动端应用、共享核心和现有 CLI/Skill 包边界；根包继续保留现有 CLI 与 Skill 构建脚本，移动端脚本使用独立命名，避免移动端依赖和原生构建步骤扰动现有发布流程。
