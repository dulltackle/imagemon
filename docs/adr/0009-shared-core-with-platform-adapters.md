# 使用共享核心与平台适配层复用 Imagemon 能力

手机应用不直接运行现有自包含 CLI 或 Skill，而是将图鉴条目契约、模板渲染、模型能力校验和图片任务请求语义沉淀为共享 TypeScript 核心，由 CLI、Skill 和手机应用分别通过平台适配层接入。现有 Promptdex 任务辅助脚本依赖 Node 文件系统、临时目录、权限位和子进程握手，这些机制适合 Agent/CLI 分发但不适合 Expo React Native；共享核心可以保留同一领域语义，同时允许手机端使用 SQLite、应用文件目录和系统安全存储。
