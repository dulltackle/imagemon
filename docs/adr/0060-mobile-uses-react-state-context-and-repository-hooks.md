# 手机端首版不引入全局状态管理库

手机端首版不引入 Redux、MobX、Zustand 或 TanStack Query 作为基础状态层。持久状态以 SQLite、文件系统和安全存储为准，由 repository 负责读写，页面通过 hooks 查询、刷新和提交操作；React context 只承载少量应用级状态，例如模型调用锁、只读恢复模式和当前配置可用性。若后续出现复杂跨页面缓存需求，再另行记录状态管理决策。
