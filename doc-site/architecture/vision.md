# 平台愿景

以下摘要来自 `docs/platform-vision-and-roadmap.md`。内部规划文档不等于产品承诺。

## 一句话

> 在用户自己的环境里，把自然语言意图稳定地变成可验证的结果。

## 平台定位

Cottage 不是「加强版代码 IDE 助手」，而是 **Platform Core + Domain Packs**：

```
┌─────────────────────────────────────────┐
│  Platform Core                          │
│  Registry · Policy · Context · Plan/Spec│
│  Staging · Verifier · Trace · Connectors│
└─────────────────────────────────────────┘
     ↑ 注册
 Coding · Office · Media · Integration · …
```

## 设计对比：方便人 vs 方便 LLM

| 维度 | 应避免为默认 | Cottage 默认 |
|------|--------------|--------------|
| 工具粒度 | `runShell("ffmpeg…")` | 语义化工具 + 预览 |
| 失败形态 | stderr 一坨 | 结构化错误 + 建议 |
| 结果 | 「我执行完了」 | 交付物 + diff + 可回滚 |
| 权限 | 模型自行折腾 | Policy + 白名单 |

## 能力栈

```
Browser Cottage（控制平面）
  ↔ Local Companion（Cottage Service）
  ↔ Cloud Connectors（规划中）
  ↔ MCP / Packs（插件平面）
```

## 路线图态度

愿景文档中的 Media Pack、更强 Connector Hub、Workflow Provider 等条目多为**方向**，落地以当前已接线功能与本站「使用指南 / 能力包」为准。
