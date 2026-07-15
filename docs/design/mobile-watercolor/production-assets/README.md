# 移动端水彩生产资产记录

## 状态

本目录记录 `apps/mobile/assets/watercolor/` 首批三项生产资产的生成、优化和验收依据。冷色主 wash、暖色平衡 wash 与图鉴空状态插画均已完成，并通过格式、透明度、体积和透明边缘验收。

## 资产清单

| 生产文件 | 角色 | 生成画布 | 生产尺寸 | 体积 | SHA-256 | 状态 |
| --- | --- | --- | --- | ---: | --- | --- |
| `catalog-wash-cool.webp` | 图鉴首页模板提炼入口的冷色主 wash | 1536×1024 | 1280×853 | 146,806 bytes | `31aefdf3ce4e448841eb3bd379e90d0e4ded0430df42cee0a94c4f3f09f31a2a` | 已完成 |
| `catalog-wash-warm.webp` | 同一入口右缘的暖色平衡 | 1254×1254 | 1024×1024 | 18,312 bytes | `cfa7dd017ae1e73ce76457c4a9a5355a2f09b712fb6a06154d53f3ffc67da85c` | 已完成 |
| `empty-state-watercolor.webp` | 图鉴完全空状态的小型插画 | 1024×1024 | 768×768 | 59,750 bytes | `ae1caeb50185cd3a78596332da4ba21228e19e7412af1bc9b637c957dbc4e078` | 已完成 |

三项生产文件合计 224,868 bytes；单张均不超过 250KB，总量不超过 750KB，长边不超过 1536px，符合合同预算。

## 生成记录

- 生成日期：2026-07-14。
- 生成方式：冷色主 wash 与空状态插画使用项目自包含 Imagemon CLI；暖色平衡 wash 的第三次尝试按开发者指定改用 Codex 内置 `imagegen` Skill，并在本地移除绿幕。
- 模型：Imagemon CLI 两项使用 `gpt-image-2`；内置生图工具未返回具体模型标识。
- 原始提示词：[冷色主 wash](prompts/catalog-wash-cool.txt)、[暖色平衡 wash](prompts/catalog-wash-warm.txt)、[空状态插画](prompts/empty-state-watercolor.txt)。
- 冷色主 wash：首次请求超时；获授权后第二次请求成功，CLI 报告 1,847 tokens。
- 暖色平衡 wash：前两次 Imagemon CLI 请求均超时；开发者明确授权第三次并指定改用 `imagegen` Skill后，内置生图成功返回 1254×1254 绿幕源图，未返回 usage。
- 空状态插画：首次请求成功，CLI 报告 1,302 tokens。
- 两次 Imagemon CLI 成功响应虽然在请求元数据中声明 `webp`，实际下载文件均为带 alpha 的 PNG；生产文件已重新编码为真正的透明 WebP。
- 暖色源图按 `imagegen` Skill 要求使用均匀 `#00ff00` 背景，本地通过边缘采样、soft matte、despill 与 1px edge contract 移除绿幕，再缩放并编码为透明 WebP。

失败请求没有产物，不进入应用包，也不以未返回的 usage 推断实际计费。

## 优化与透明边缘验收

- 只做等比缩放、绿幕移除、移除元数据和 WebP 重新编码，没有裁切概念截图、重绘 UI、添加文字或改变构图角色。
- 冷色主 wash 保留 1280×853 横向构图，以 `contain` 锚定入口左上；暖色平衡 wash 保留 1024×1024 右上角构图，以较小尺寸锚定入口右缘；空状态插画保留 768×768 方形构图，以 `contain` 居中。
- 三项文件均由 `file` 与 ImageMagick `identify` 确认为 `WEBP`、sRGBA、非不透明图像。
- 三项文件均已分别合成到纯白 `#ffffff` 与页面纸张色 `#faf8f5` 上并使用 `view_image` 检查；透明边缘没有可见绿边、黑边、白边或不透明底色。
- 未对图片应用色罩、滤镜或混合模式；冷色与空状态强度由资产自身 alpha 决定，暖色整体 opacity 由受控的 `WatercolorBackdrop.catalogWarm` variant 固定为 50%，不向业务页面开放调整入口。

## 来源与使用边界

三项资产均以 Imagemon 自有提示词独立生成，不从已批准概念截图裁切，也没有复制 StyleKit 的代码、showcase 图片或生产资产。StyleKit 仅提供设计方向参考，因此本批文件没有引入其 MIT 资产归属。

生成内容的使用仍受所调用模型服务条款、仓库许可证和发布政策约束；本记录只说明技术来源与第三方资产边界，不替代法律审查。
