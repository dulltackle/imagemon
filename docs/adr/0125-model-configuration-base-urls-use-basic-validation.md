# 模型配置 base URL 做基础校验

模型配置页面保存 base URL 时必须做基础 URL 校验：只接受 `https://` URL，拒绝空 host 和明显非法 URL。base URL 可以包含 API 版本前缀路径，例如 `/v1`，但不能写到具体接口路径，例如 `/v1/images/generations`。query 和 userinfo 不做敏感信息扫描，也不因为用户名密码或疑似 token 片段而自动拦截。该校验只保证连接形态和 OpenAI 兼容 base URL 边界基本可用，不承担敏感信息检测职责。
