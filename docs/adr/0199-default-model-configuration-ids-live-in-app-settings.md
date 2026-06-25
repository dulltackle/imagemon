# 默认模型配置引用保存在应用设置中

手机端 SQLite schema 将模型配置自身与默认身份分开保存：`model_configurations` 保存图片模型配置和文本模型配置，应用设置记录 `default_image_model_configuration_id` 与 `default_text_model_configuration_id`。不在模型配置记录上使用 `isDefault` 字段，是为了让“配置是否就绪”和“是否被选为默认配置”保持独立，便于在测试失败、字段变更、凭据变更或删除配置时清除默认引用，并避免列表更新时维护同类型配置之间的互斥标记。
