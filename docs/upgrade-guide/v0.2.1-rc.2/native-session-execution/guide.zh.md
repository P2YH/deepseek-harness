---
kind: upgrade-guide
description: Session Controller 不再提供 configureExecution，也不再应用保存的工作台输出预算。
---
# 原生会话执行设置

[English](guide.md) | 中文

## 变更

移除 `sessionController.configureExecution` 和 `SessionConfigureExecutionRequest`。模型请求继承组合 DSH Agent 的配置。历史 `session/execution-config` 事件保持可读，冷恢复后也不再覆盖 `maxTokens`。现有会话日志无需改写。

## 迁移

1. 从工作台集成中移除 `sessionController.configureExecution` 调用及 `SessionConfigureExecutionRequest` 导入。
2. 需要主动设置模型参数时，使用正常的 DSH Agent 或供应商配置。不要用工作台截止时间或 token 预算替代已移除 API。
3. 恢复保存的会话并检查下一个 `request/header`：输出设置应遵循组合 Agent 配置，不受历史 `session/execution-config` 事件影响。
