---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-21-session-execution-budget

English | [中文](2026-10-21-session-execution-budget.zh.md)

## Summary

Adds the required session/execution-config event carrying a nullable output token budget.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing V4 records remain valid. New records require a reader that recognizes session/execution-config; older readers reject the required event rather than silently resuming with a different budget. A null budget restores the composed default.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/api/session-controller/tests/session-models.host.spec.ts: 30 tests passed, including applied, cleared, restored and rejected execution budgets.

<a id="dev-note"></a>
## Dev Note

None.
