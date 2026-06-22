# 手机端使用 expo-sqlite 且不引入 ORM

手机端首版本地数据库使用 Expo 官方 `expo-sqlite`，不引入 ORM。SQLite schema、事务和迁移由移动端适配层维护，共享核心不依赖 SQLite；移动端 repository 暴露领域操作并隔离 SQL，不把 SQL 泄漏到 UI 层。迁移失败时遵循只读恢复模式。
