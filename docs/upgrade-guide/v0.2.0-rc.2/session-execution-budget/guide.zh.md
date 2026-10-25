---
kind: upgrade-guide
description: "保存了执行预算的会话需要能识别必需 session/execution-config 事件的读取程序。"
---

# 保存会话执行预算

[English](guide.md) | 中文

## 变更

公开 Session Controller 支持 `configureExecution({sessionId,maxTokens})`。保存或清除预算会追加必需的 `session/execution-config` 事件。旧读取程序会拒绝包含该事件的会话；不含该事件的现有会话仍可读取。参见[持久化兼容性记录](../../../persistence-changes/2026-10-21-session-execution-budget.zh.md)。

## 迁移

1. 使用要求 `configureExecution` 的办公插件前，一同升级 Host 和所有读取其会话的应用。升级前备份现有 Harness 主目录。
2. 对空闲会话设置正整数输出预算，传入 `null` 恢复组合默认值。执行中的会话拒绝修改。配置影响后续模型请求，并在重启后保留。
3. 确认原生会话记录包含 `session/execution-config`，下一条 `request/header` 中的 `config.maxTokens` 符合预期；重启后确认预算仍生效。回退后的旧读取程序无法读取这些新记录；必须回退时恢复升级前备份。不要通过删除事件让旧读取程序接受会话。
