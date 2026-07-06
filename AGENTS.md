# Agent 使用说明

## 发布操作

发布由 `.github/workflows/release.yml` 自动完成，仅推送与 `package.json` 版本严格匹配的
`v<version>` 标签时触发。不要手工创建 GitHub Release，也不要推送与包版本不一致的发布标签。

1. 通过 `npm run version:sync -- <newversion>` 命令统一更新根与所有 workspace 子包
   （`packages/core`、`apps/mobile`）的版本号；版本号必须全局一致，`verify` 会拦截不一致。
2. 重建 Skill 中自包含的 CLI，并运行统一验证。正常安装依赖后，提交前 Git hook 会自动执行
   `npm run build:skill` 并暂存生成产物；如果使用 `--no-verify`、未安装 hook 或需要手动确认产物，
   必须显式运行：

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

标签推送后，发布流水线会再次重建并验证 Skill，将 `.agents/skills/imagemon`、`.agents/skills/imagemon-promptdex` 和 `.agents/skills/imagemon-promptdex-builder` 打包为单个`imagemon-skills-v<version>.skill`，并创建或更新对应 GitHub Release。
