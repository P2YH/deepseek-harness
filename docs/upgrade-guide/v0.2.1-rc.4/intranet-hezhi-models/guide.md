---
kind: upgrade-guide
description: "The built-in Hezhi Qwen provider is removed and the Hezhi DeepSeek endpoint changes."
---

# Intranet Hezhi model configuration

English | [中文](guide.zh.md)

## Change

The intranet catalog no longer includes `hezhi` / `Qwen3.6-27B`. The `hezhi-dsv4` provider now uses `http://10.139.133.3:8001/hz_model_dpsk/v1`. Profile overrides and saved model selections continue to take precedence over built-in defaults.

## Migration

1. If `$DSH_HOME/profiles/desktop/cordis.patch.yml` overrides `llm-pi-ai`, remove its `hezhi` provider and update the `hezhi-dsv4` `baseURL` to `http://10.139.133.3:8001/hz_model_dpsk/v1`. Apply the same changes to any other profile or overlay that overrides the provider configuration.
2. Change any saved default or session selection using `hezhi` / `Qwen3.6-27B` to an available model. Restart Desktop and check the provider list and endpoint in Settings → Models.
3. New deployment-key files need `DIZHI_API_KEY` and `HEZHI_DSV4_API_KEY`. Existing files may retain `HEZHI_API_KEY`; it is ignored when provisioning credentials.
