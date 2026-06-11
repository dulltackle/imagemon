# Agent 使用说明

- 需要生成或修改图片时，优先调用 CLI，不要直接拼接底层图片 API：
- 测试失败时，不要通过修改测试、断言、Mock、Fixture 或跳过测试来绕过失败；应修复生产代码。

## 发布操作

发布由 `.github/workflows/release.yml` 自动完成，仅推送与 `package.json` 版本严格匹配的
`v<version>` 标签时触发。不要手工创建 GitHub Release，也不要推送与包版本不一致的发布标签。

1. 通过 `npm version` 命令更新 `package.json` 中的版本号。
2. 重建 Skill 中自包含的 CLI，并运行统一验证：

```bash
npm run build:skill
npm run verify
```

3. 提交版本号、重新构建的 Skill CLI 和本次发布包含的其他改动。
4. 从 `package.json` 读取版本，创建并推送对应标签：

```bash
version="$(node -p "require('./package.json').version")"
git tag "v${version}"
git push origin "v${version}"
```

标签推送后，发布流水线会再次重建并验证 Skill，将 `skills/imagemon`、`skills/imagemon-promptdex` 和 `skills/imagemon-promptdex-builder` 打包为单个`imagemon-skills-v<version>.skill`，并创建或更新对应 GitHub Release。
