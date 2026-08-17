# 图片生成

启用 **图片生成** 后，Agent 可以按描述生成图片，或基于工作区内已有图片进行编辑和变体生成。生成结果会保存到当前工作区的 `images/` 目录，并在对话中展示。

## 开始前

1. 在聊天区的 **模型与能力** 中打开 **图片生成**。
2. 到 **设置 → 模型配置** 添加或编辑模型预设，配置生图厂商、模型和 API Key；也可选择跟随当前对话预设。
3. 图像编辑时，先把参考图放进工作区，并在请求中说明路径。

## 怎么说

<div class="oc-prompt">
  <span class="oc-prompt__label">生成图片</span>
  为 docs/landing-page.md 生成一张 16:9 的深绿色产品页头图：本地文件夹、任务卡片和审阅 diff 的抽象界面，不要文字。保存到 images/hero.png。
</div>

<div class="oc-prompt">
  <span class="oc-prompt__label">编辑图片</span>
  基于 assets/poster.png，保留构图和人物，把背景改成暖灰色纸张质感，去掉右下角的日期。保存为 images/poster-v2.png。
</div>

## 使用边界

- 图片生成会调用你配置的生图厂商，并按该厂商规则与用量计费。
- 一次生成多张图片时，Agent 会先征求确认。
- 编辑只接受工作区内已有的图片；不确定路径时先让 Agent 查找文件。
- 当前对话模型不支持图片理解时，生成结果仍会保存，但 Agent 无法据此做视觉检查。

## 相关

- [设置界面 · 图片](/guide/settings)
- [文件预览](/concepts/file-preview)
