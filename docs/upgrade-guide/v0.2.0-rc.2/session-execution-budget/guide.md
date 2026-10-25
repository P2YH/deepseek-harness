---
kind: upgrade-guide
description: "Sessions with saved execution budgets require a reader that recognizes the required session/execution-config event."
---

# Saved Session execution budgets

English | [中文](guide.zh.md)

## Change

The public Session Controller supports `configureExecution({sessionId,maxTokens})`. Saving or clearing a budget appends the required `session/execution-config` event. Older readers reject Sessions containing this event. Existing Sessions without it remain readable. See the [persistence acknowledgement](../../../persistence-changes/2026-10-21-session-execution-budget.md).

## Migration

1. Upgrade the Host and every application that reads its Sessions together before using office plugins that require `configureExecution`. Keep a backup of the existing Harness home before upgrading.
2. Set a positive integer output budget on an idle Session; pass `null` to restore the composed default. Running Sessions reject changes. Configuration affects subsequent model requests and survives restart.
3. Confirm the native Session record contains `session/execution-config` and the next `request/header` records the expected `config.maxTokens`. After restart, confirm the same budget applies. A reader rollback cannot read these new records; restore a pre-upgrade backup if rolling back is necessary. Do not delete events to make an older reader accept the Session.
