# Agent 使用说明

- 与本仓库协作时，优先使用中文沟通和记录结论。
- 需要生成或修改图片时，优先调用 CLI，不要直接拼接底层图片 API：

```bash
gpt-image generate --prompt "生成一张图片" --out ./outputs
gpt-image edit --image ./input.png --prompt "修改图片" --out ./outputs
```

- CLI 的 stdout 始终是一行 JSON。Agent 应解析其中的 `ok`、`files`、`metadataPath`、`usage`、`error` 字段。
- 图片文件和元数据由 CLI 写入输出目录，默认是 `./outputs`。
- 测试失败时，不要通过修改测试、断言、Mock、Fixture 或跳过测试来绕过失败；应修复生产代码。
