# 手机端模板提炼使用 Chat Completions 且不自动降级重试

手机端首版模板提炼通过设备使用者选中的就绪文本模型配置调用 OpenAI 兼容的 `/chat/completions` 接口，并要求模型返回纯 JSON 文本；请求可以携带 `response_format: { "type": "json_object" }` 来表达结构化输出约束。首版不使用 Responses API、工具调用或流式输出，因为当前模型配置面向 OpenAI 兼容服务，Chat Completions 的兼容面更广，也更符合现有 base URL、模型名和 API Key 配置形态。

如果服务端不支持 `response_format`、拒绝该字段或返回非 JSON 输出，应用不自动移除字段后重试；本次生成方案按失败处理，并保留可重新生成的提炼草稿。这样避免一次设备使用者动作隐式产生两次文本模型调用、两次费用和更长的全局模型调用锁占用，也保持首版模板提炼失败语义简单可解释。
