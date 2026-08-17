# 专题

这里解释 Open Cottage 里常见的名词和机制，并把相关操作写在一起。  
看完再去 [上手指南](/guide/first-setup) 或 [按场景操作](/guide/use-office)，会对得上号。

## 建议阅读顺序

1. [工作区](./workspace) — Agent 能碰哪些文件  
2. [数据在本地](./local-data) — `.cottage/` 里有什么  
3. [两层配置：域名与工作区](./storage-layers) — 设置存在哪、跟不跟文件夹走  
4. [模型、预设与 API Key](./models-and-keys) — 怎么配模型、Key 藏在哪  
5. [能力包](./capability-packs) — 为什么有的本事要先打开  
6. [文件预览](./file-preview) — 怎么在预览区验收结果  
7. [对话、计划与会话](./chat-modes) — 两种协作方式  
8. [暂存审阅与审批](./governance-concepts) — 如何保持可核对  
9. [Skills 技能](./skills-concepts) — 可复用的说明书  
10. [Cottage Service](./cottage-service-concepts) — 本机伴随服务
11. [@ 引用与附件](./mentions-and-attachments) — 怎么把材料钉进对话
12. [「模型与能力」面板](./model-capability-panel) — 聊天区上方的控制台

## 一张总图

```
你（浏览器）
 ├─ IndexedDB（本机浏览器里）
 │    ├─ API Key / 部分密钥
 │    ├─ 域名级配置与模型预设
 │    └─ 工作区文件夹句柄（最近打开）
 │
 └─ 工作区文件夹（你授权的目录）
      ├─ 你的项目文件
      └─ .cottage/   ← 会话、工作区配置、附件…
           （可随文件夹备份、拷贝）
```

想「跟做场景」请看 [五分钟配置](/guide/first-setup) 与 [按场景操作](/guide/use-office)；想查工具名请看 [工具目录](/reference/tools)。
