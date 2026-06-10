# 将 Promptdex 模板提炼与图片任务执行分离

从外部完整提示词反向提炼图鉴条目由独立的 `building-imagemon-promptdex` skill 负责，不扩展执行图片任务的 `imagemon-promptdex`。模板提炼会处理不可信外部文本、设计新的模板输入并写入长期复用资产，且任何 Agent 提出的新规则都必须经过用户批准，因此它需要独立的触发边界和落盘前方案确认流程。
