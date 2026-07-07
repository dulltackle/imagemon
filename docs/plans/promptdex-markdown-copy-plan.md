# 图鉴条目 Promptdex Markdown 复制实现计划

本文描述手机端在图鉴条目详情页复制当前条目 Promptdex Markdown 的实现计划。目标是让设备使用者能在查看内置图鉴条目时，一键把该条目的可解析 Promptdex 模板 Markdown 写入系统剪贴板，同时保持该动作与图鉴条目文件导出的边界清晰分离。

## 已确认范围

- 本功能是 `图鉴条目 Markdown 复制`，不是复制 `模板正文`，也不是复制 `完整提示词`。
- 入口只出现在图鉴条目详情页，不出现在图鉴列表卡片上。
- 入口放在条目描述之后、执行表单之前；声明 `mask` 暂不支持执行的条目也展示该入口。
- 内置图鉴条目允许复制 Promptdex Markdown，但这不是文件级图鉴条目导出。
- 复制内容采用当前 `@imagemon/core` 可解析的 Promptdex 模板 Markdown 格式。
- 复制文本采用规范序列化：frontmatter 依次输出 `name`、`description`、可选 `version`、`inputs`，然后输出正文。
- 复制文本末尾保留一个最终换行。
- frontmatter 标量必须做 YAML 安全序列化，避免特殊字符导致复制出的 Markdown 不可解析。
- 展示与复制使用同一份 Promptdex Markdown 文本。
- Accordion 默认收起，不持久化；每次进入详情页或切换条目都回到收起状态。
- Accordion 标题为 `Promptdex Markdown`，展开后展示完整 Markdown，文本允许长按选择。
- 复制按钮在 Accordion 收起状态也可点击。
- 复制按钮使用图标按钮，不显示文字，`accessibilityLabel` 为 `复制 Promptdex Markdown`。
- 复制动作不受全局模型调用锁、任务提交状态或图片选择状态影响。
- 复制采用本地 800ms 防抖：首击立即执行，防抖窗口内重复点击忽略，并显示轻量 loading。
- 复制成功显示页面内反馈 `Promptdex Markdown 已复制。`。
- 复制失败显示页面内反馈 `无法复制到剪贴板，请稍后重试。`。
- 只保证复制文本可被当前 `parsePromptdexTemplate` 解析，不承诺手机端支持从剪贴板导入。

## 明确不做

- 不新增图鉴列表页复制入口。
- 不新增内置图鉴条目的单条文件导出。
- 不新增从剪贴板导入图鉴条目。
- 不补齐任务历史详情页的历史完整提示词复制。
- 不把复制动作写入任务历史、设置、备份或其他持久状态。
- 不把当前任务输入拼接进复制内容。
- 不复制模型配置、API Key、图片规格、图片结果、任务历史或封面示例图。
- 不把 Accordion 展开状态保存到数据库、设置或备份。

## 依赖决策

- `CONTEXT.md`：`Promptdex Markdown`、`图鉴条目 Markdown 复制`、`模板正文`、`完整提示词`。
- ADR 0001：Promptdex 模板契约由 frontmatter、输入声明和正文构成。
- ADR 0044：内置图鉴条目仍不提供单条文件导出。
- ADR 0205：内置图鉴条目允许复制 Promptdex Markdown，但复制不等同于文件导出。

## Promptdex Markdown 格式

序列化结果示例：

```md
---
name: light-infographic
description: 将一段文字转换为浅色、清爽、结构清晰的解释性信息图
version: 1
inputs:
  content:
    required: true
    description: 需要转换为单张配图的一段文字
  title:
    required: false
    description: 帮助理解内容的辅助标题
---

# 浅色解释性信息图

...
```

规则：

- `name` 必须来自当前模板对象，不从路由参数重新拼接。
- `description`、输入描述等单行文本使用 YAML 安全标量序列化。
- `version` 仅在模板对象显式包含该字段时输出。
- `inputs` 保持模板对象中的声明顺序。
- 每个输入只输出 `required` 和 `description`。
- 正文保持模板对象中的 `body` 原样，不追加当前任务输入。
- 输出末尾保留最终换行。
- 生成后应能被 `parsePromptdexTemplate(markdown, template.fileName)` 重新解析。

## 交互状态

Accordion 状态：

- `collapsed`：默认状态，只显示标题行、展开按钮和复制按钮。
- `expanded`：展示完整 Promptdex Markdown 文本，文本可选择。

复制状态：

- `idle`：可触发复制。
- `copying`：本地 800ms 防抖窗口内的轻量 loading 状态；重复点击忽略。

页面内反馈：

- 成功：`Promptdex Markdown 已复制。`
- 失败：`无法复制到剪贴板，请稍后重试。`

## 可执行子任务与提交边界

### 1. 记录领域语言、ADR 与实现计划

Commit 标注：`docs: 记录图鉴条目 Markdown 复制边界`

改动范围：

- 在 `CONTEXT.md` 中确认 `Promptdex Markdown`、`图鉴条目 Markdown 复制` 和 `模板正文` 的术语边界。
- 新增 ADR 0205，记录内置图鉴条目允许复制 Promptdex Markdown，但仍不提供单条文件导出。
- 新增本文档，冻结范围、交互、序列化规则和提交拆分。

验收：

- 文档明确区分 `图鉴条目 Markdown 复制`、`图鉴条目导出`、`模板正文` 和 `完整提示词`。
- 每个后续子任务都有独立 commit 标注。

### 2. 增加 Promptdex Markdown 规范序列化能力

Commit 标注：`feat: 支持序列化 Promptdex Markdown`

改动范围：

- 在 `packages/core/src/promptdex.ts` 增加并导出 Promptdex 模板 Markdown 序列化函数。
- 序列化函数接收 `PromptdexTemplate`，返回可解析 Markdown 文本。
- 实现受限 YAML 安全标量序列化。
- 保持输入声明顺序，输出最终换行。

验收：

- 单元测试验证内置形态模板序列化后可被 `parsePromptdexTemplate` 重新解析。
- 单元测试验证特殊字符、冒号、引号、`#`、前后空白等描述文本不会破坏解析。
- 单元测试验证输出不包含当前任务输入、图片规格或模型配置。

### 3. 接入 Expo Clipboard 依赖

Commit 标注：`build: 接入剪贴板依赖`

改动范围：

- 使用 Expo SDK 匹配方式安装 `expo-clipboard`。
- 更新 `apps/mobile/package.json` 和根 `package-lock.json`。
- 确认无需新增与相册、相机或文件访问相关的权限配置。

验收：

- `apps/mobile` 能解析 `expo-clipboard` 类型。
- 不引入与剪贴板无关的原生权限或插件配置。

### 4. 封装复制防抖与页面反馈逻辑

Commit 标注：`feat: 封装图鉴 Markdown 复制控制`

改动范围：

- 在移动端实现本地复制控制逻辑，支持首击立即执行、800ms 防抖窗口、轻量 loading 和重复点击忽略。
- 复制成功或失败只返回当前页面可展示的一次性反馈。
- 逻辑可以先服务图鉴详情页，但接口保持足够简单，便于后续历史完整提示词复制复用。

验收：

- 防抖窗口内重复触发不会重复调用剪贴板写入。
- 防抖不受模型调用、任务提交或图片选择状态影响。
- 失败路径不会修改任务输入、模型调用状态或持久仓储。

### 5. 在图鉴条目详情页加入 Accordion 与复制入口

Commit 标注：`feat: 图鉴详情支持复制 Promptdex Markdown`

改动范围：

- 在 `apps/mobile/src/promptdex/PromptdexEntryDetailScreen.tsx` 中生成当前模板的 Promptdex Markdown。
- 在条目描述之后、执行表单之前加入默认收起的 `Promptdex Markdown` Accordion。
- 标题行提供展开/收起控制和复制图标按钮。
- 展开后展示完整 Markdown，文本 `selectable`。
- 复制按钮使用 `accessibilityLabel="复制 Promptdex Markdown"`。
- 成功或失败复用页面内反馈，不弹窗。

验收：

- 进入任意内置图鉴条目详情页时 Accordion 默认收起。
- 收起状态点击复制按钮可以复制 Markdown。
- 展开后展示内容与复制内容一致。
- 切换条目后展开状态重置。
- 蒙版暂不支持执行的图鉴条目仍能查看并复制 Markdown。

### 6. 补齐测试与验证

Commit 标注：`test: 验证图鉴 Markdown 复制能力`

改动范围：

- 补齐序列化单元测试。
- 对复制防抖逻辑补充可测试的纯函数或轻量单元测试。
- 运行移动端类型检查，覆盖详情页 UI 改动。
- 不为了通过测试修改既有测试断言、Mock、Fixture 或测试辅助逻辑。

验收：

- `npm run mobile:test` 通过。
- `npm run mobile:typecheck` 通过。
- 如序列化函数位于核心包，相关核心包测试通过。

## 推荐实施顺序

1. 先提交文档、术语和 ADR，冻结共享理解。
2. 再实现核心序列化和测试，确保复制内容的格式稳定。
3. 接入 `expo-clipboard`，单独隔离依赖变更。
4. 封装复制防抖和反馈控制，避免 UI 里堆状态细节。
5. 最后接入图鉴详情页 Accordion 和复制按钮。
6. 以测试和类型检查收尾。

## 风险与注意事项

- 不要把复制 Promptdex Markdown 写成文件导出，否则会和 ADR 0044 冲突。
- 不要复用 `完整提示词` 文案，复制对象不是渲染后的任务指令。
- 不要把当前任务输入、图片规格、模型配置或凭据放入复制内容。
- YAML 序列化必须保守，宁可对不安全标量加引号，也不要生成不可解析 Markdown。
- 800ms 防抖只约束重复点击，不应阻塞其他页面操作或全局模型调用。
- 历史完整提示词复制已有 ADR 约束，但不在本次实现范围内。
