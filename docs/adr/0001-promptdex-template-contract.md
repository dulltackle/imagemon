# 使用输入声明驱动 Promptdex 图片任务

Imagemon Promptdex 的图鉴条目使用自包含的简单 YAML frontmatter 声明输入，并以是否存在 `inputs.image` 推断生成或编辑任务；模板通过目录动态发现，不维护索引或额外的 `mode` 字段。模板契约由 Promptdex 的独立 reference `references/template-contract.md` 承载，运行 skill 与 Builder 都读取该稳定契约，不互相依赖顶层工作流说明。该约定减少了模板元数据重复和失配风险，也避免为 YAML 解析新增项目依赖，但要求未来模板遵守受限结构，并在修改后运行校验脚本。

手机应用延续该契约：任务类型标识是从输入声明推断得到的展示结果，不是条目展示信息中的独立可编辑字段。导入、提炼或恢复时如果图鉴条目声明独立任务类型字段，应拒绝写入。
