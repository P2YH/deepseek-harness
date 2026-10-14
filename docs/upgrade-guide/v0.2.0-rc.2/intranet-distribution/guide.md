---
kind: upgrade-guide
description: "Intranet GUI deployments disable official accounts and require a configured custom model before model tasks can run."
---

# Intranet GUI distribution

English | [中文](guide.zh.md)

## Change

Desktop and Web can run with a fixed `intranet` distribution policy. Standard deployments retain official integrations. Intranet deployments enter the workspace without an account or model, hide official login, balance and account model configuration, and disable official model providers, updates, analytics, feedback uploads, session-log uploads, search and public plugin registry probes. Editable profile layers cannot re-enable these integrations.

Existing profiles retain conversations, attachments, plugins, custom models and credential files. Official credentials are not used or automatically deleted. An old official default becomes no default. Historical model records remain unchanged; opening a conversation with an unavailable model does not resume its queued work. Explicitly select an available custom model before sending or resuming. A conversation selection still updates the global default for subsequent new conversations.

The Session API's `ModelCatalog.default` and `agentDefaultModel.currentSelection()` now return `null` when no default is configured. The default-model plugin accepts an empty config; `provider` and `model` must otherwise be provided together. Intranet model tasks reject unavailable models before dispatch.

Plugin installation accepts local packages with offline dependency resolution or an explicitly configured non-public registry. It does not fall back to a public registry. The policy governs built-in integrations and installation entry points; it does not provide an operating-system firewall or restrict arbitrary plugin code.

## Migration

1. For Web, export `DSH_DISTRIBUTION_MODE=intranet` in the launching process, then start `dsh web`. Do not put this bootstrap variable in a runtime `.env`. For Windows Desktop builds, set `DSH_DISTRIBUTION_MODE=intranet` in the build-owned `apps/desktop/.env.windows`; the packaged application embeds its mode and does not accept an environment override to standard. See the [Desktop build reference](../../../../apps/desktop/README.md).
2. Keep the existing Harness home and profile files. Configure your own model endpoint in Settings → Models, then select an available model. If you require plugin dependencies, prepare an offline cache or configure your internal registry; local `.tgz` installation remains available.
3. Update external consumers of `ModelCatalog.default` and `currentSelection()` to handle `null`. The standard profile's supplied official default remains unchanged.
4. Confirm the workspace opens without login, Settings has no official account onboarding, no official models are selectable, and a task without a configured model gives a model-selection error. Reopen an old conversation and confirm its history remains readable before selecting a replacement model.
