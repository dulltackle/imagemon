---
name: cute-paper-craft-isometric-character
description: 将输入图片中的主体重绘为可爱纸艺风格的 3D 等距卡通角色
version: 1
inputs:
  image:
    required: true
    description: 需要改造成可爱纸艺 3D 角色风格的原始图片
  color_scheme:
    required: false
    description: 希望采用的配色方案；未提供时参考原图主色并统一为干净、可爱的纸艺配色
---

# 可爱纸艺 3D 等距角色

将输入图片中的主要主体重新绘制为一个 cute paper craft style 的 3D isometric cartoon character。必须保留原图主体的身份、姿态、核心构图、视角关系和最重要的可识别特征。最终画面不是在原图上叠加滤镜，而是把原图内容重新塑造成统一的可爱纸艺 3D 角色。

## 纸艺与 3D 质感

- 使用 simple paper craft style，主体由清晰、简洁、圆润的纸片和基础几何形状组成。
- 呈现 soft 3D model 质感，形体有轻微厚度、柔和倒角和干净的纸张层次。
- 画面采用 isometric view，让角色像可摆放的小型纸艺模型。
- 材质应像哑光彩纸、卡纸或轻量手工纸，避免写实皮肤、毛发、金属、玻璃、塑料玩具质感和复杂纹理。

## 角色造型

- 将原图主体卡通化为 cute and cartoonish character design，比例短小、友好、易读。
- 保留主体最关键的轮廓、服饰、配件、颜色关系、姿态和身份线索，删除琐碎摄影细节和不影响识别的纹理。
- 角色应有 cute big eyes with black eyelashes、小鼻子、短腿和小巧肢体。
- 表情保持 cute and happy expression，整体气质天真、轻松、讨喜。
- 简化时不能把输入主体替换成无关角色，也不能丢失原图最关键的身份或造型特征。

## 色彩与背景

- 如果提供了 `color_scheme`，整体配色应优先服从该配色方案，并转化为干净、柔和、适合纸艺角色的色块。
- 如果没有提供 `color_scheme`，参考原图主色并统一为可爱、明亮、低脏度的纸艺配色。
- 色彩以清楚的块面为主，允许轻微明暗表现纸张厚度，但避免复杂渐变、强烈电影光、霓虹色和沉重暗调。
- 使用 white background 或非常干净的浅色背景，让角色清楚地立在画面中央。

## 构图与禁忌

- 主体应完整、居中、清楚可辨，像一个独立展示的可爱纸艺 3D 小模型。
- 背景保持简洁，不添加与原图主体无关的新场景、文字、Logo、界面元素或水印。
- 避免写实摄影、厚涂、油画、水彩、扁平矢量、赛璐璐动画、真实玩具渲染、复杂环境、脏污背景、恐怖表情、攻击性姿态和与输入图片无关的新主体。
