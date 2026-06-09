# 使用输入声明驱动 Promptdex 图片任务

Imagemon Promptdex 的图鉴条目使用自包含的简单 YAML frontmatter 声明输入，并以是否存在 `inputs.image` 推断生成或编辑任务；模板通过目录动态发现，不维护索引或额外的 `mode` 字段。该约定减少了模板元数据重复和失配风险，也避免为 YAML 解析新增项目依赖，但要求未来模板遵守受限结构，并在修改后运行校验脚本。
