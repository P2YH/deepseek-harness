---
kind: upgrade-guide
description: Session Controller no longer exposes configureExecution or applies saved workbench output budgets.
---
# Native Session execution settings

English | [中文](guide.zh.md)

## Change

`sessionController.configureExecution` and `SessionConfigureExecutionRequest` are removed. Model requests inherit the composed DSH Agent configuration. Historical `session/execution-config` events remain readable and no longer override `maxTokens`, including after cold resume. Existing Session logs do not need rewriting.

## Migration

1. Remove calls to `sessionController.configureExecution` and imports of `SessionConfigureExecutionRequest` from workbench integrations.
2. Set any intentional model configuration through the normal DSH Agent or provider configuration. Do not replace the removed API with workbench deadlines or token budgets.
3. Resume a saved Session and check its next `request/header`: the output settings should follow the composed Agent configuration, regardless of historical `session/execution-config` events.
