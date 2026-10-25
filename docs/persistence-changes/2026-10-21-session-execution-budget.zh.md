---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-21-session-execution-budget

[English](2026-10-21-session-execution-budget.md) | 中文

## 概述

新增必需事件 session/execution-config，保存可为 null 的输出 token 预算。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-21-session-execution-budget
baseline: false
changes:
  - root: "event:session/execution-config"
    previous: null
    after: "8bc00333d964d795efa25e867cf3efba9bcd8d88e3ae784e4c015d1c515e1961"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有 V4 记录继续有效。读取新记录需要识别 session/execution-config；旧读取器拒绝该必需事件，避免按不同预算静默恢复。null 表示恢复组合默认值。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/api/session-controller/tests/session-models.host.spec.ts：30 项测试通过，涵盖预算应用、清除、恢复与拒绝。

<a id="dev-note"></a>
## 开发备注

无。
