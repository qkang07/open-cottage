# Skills 技能

**Skill** 是一份给 Agent 读的 Markdown 说明书：写作规范、排版流程、固定步骤等。  
它不是新的「按钮 App」，而是可注入上下文的操作指南。

## 从哪里来

1. 工作区根目录 `SKILLS/`  
2. 能力包自带  
3. 设置中的内置技能库

## 你怎么用

### 方式 A：放进工作区

1. 在工作区根目录建文件夹 `SKILLS/`  
2. 放入带有 frontmatter 的 Markdown 技能文件
3. 新开对话，或让它「按某某技能执行」  

<Callout kind="tip">工作区存在 `SKILLS/` 后会被自动发现；是否注入 Agent 仍以技能 frontmatter 与设置中的开关为准。</Callout>

### 方式 B：在设置中管理

1. 打开 **设置 → 能力配置 → 技能**  
2. 查看工作区与全局技能
3. 按需启用内置技能库，并决定是否尊重 frontmatter 的 `enabled` 字段

![设置中的技能管理界面](/images/settings-skills.png)

### 示例说法

<div class="oc-prompt">
  <span class="oc-prompt__label">示例</span>
  按 PPT 美化相关技能，把 @decks/draft.pptx 重排成咨询风，保持原有页数与结论，输出 decks/draft-polished.pptx。
</div>

## 运行时发生什么

1. 系统挑选相关技能，把**摘要**放进提示  
2. 需要细节时，Agent 再 `readFile` 读全文  
3. 按说明书步骤调用已打开的能力工具  

## 编写自己的技能（简版）

- 写清：什么时候用、步骤、验收标准  
- 文件名与标题直观  
- 正文可以长，但开头摘要要短  

独立 Skills 侧栏当前未作为主入口，请以 **设置 + `SKILLS/` 目录** 为准。

## 和能力包的区别

| | 能力包 | Skill |
|--|--------|-------|
| 提供 | 工具（能不能做） | 方法（怎么做得好） |
| 开关 | 模型与能力面板 | 目录 / 设置安装 |
| 例子 | 办公文档包 | PPT 美化说明书 |

## 相关

- [能力包](./capability-packs)  
- [设置界面](/guide/settings)
