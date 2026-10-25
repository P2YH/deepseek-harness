# Intranet model packaging and configuration

English | [中文](intranet-model-packaging.zh.md)

## Summary

Configure Dizhi Technology and Hezhi on an intranet Windows Desktop installation without an official account. Both services use the existing pi-ai adapter. The installer carries endpoint configuration and credential references; each target machine stores its own API keys.

## Table of Contents

- [Endpoints](#endpoints)
- [Packaging](#packaging)
- [Installation and upgrades](#installation-and-upgrades)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="endpoints"></a>

## Endpoints

Use the Base URL below, without appending `/chat/completions` in configuration. The adapter adds that suffix. Preserve the Dizhi `/openai/v1` prefix and the exact model ID.

| Field | Dizhi Technology | Hezhi |
| --- | --- | --- |
| Provider ID | `dizhi` | `hezhi` |
| Model ID | `gen-studio-Qwen3.6-27B-ygNP` | `Qwen3.6-27B` |
| Base URL | `http://10.76.22.59/openai/v1` | `http://10.139.133.3:8001/v1` |
| Credential reference | `DIZHI_API_KEY` | `HEZHI_API_KEY` |
| Output-limit field | `max_tokens` | `max_completion_tokens` |
| Thinking parameter | Not configured | `chat_template_kwargs.enable_thinking` |
| Declared input | Text | Text and images; vision is not live-verified |

Both routes use `openai-completions` and Bearer authentication. Context/output budgets of 32768/8192 tokens are provisional deployment settings, not verified service limits.

<a id="packaging"></a>

## Packaging

Follow the [Desktop packaging procedure](../../apps/desktop/README.md#release-versions) with `DSH_DISTRIBUTION_MODE=intranet` in the build configuration. The [Web bundle patch](../../packages/bundle/web-app/cordis.patch.yml) owns these intranet provider defaults. Verify that the prepared runtime and final ASAR include its updated patch and the official adapter. A developer Profile edit does not update an installer.

The source composition currently defaults to Hezhi. To make new installations default to Dizhi, update the intranet branches of `agent-default-model` in the bundle patch to `dizhi` and `gen-studio-Qwen3.6-27B-ygNP`, retain the standard-mode branches, and update the owning tests. An existing Profile's saved selection still takes precedence.

The local installer `0.2.0-rc.2.20261008.1` predates these provider additions; configure its Profile as below or rebuild it. Normal builds carry no keys. A private intranet deployment may explicitly provision just the two model keys as described below; never copy a developer credentials file or an entire Harness home into an installer.

### Optional deployment keys

For an authorized internal installer that must work without entering keys, set `DSH_DESKTOP_INTRANET_MODEL_KEYS_FILE` in `apps/desktop/.env.windows` to a private JSON file outside the source tree. Relative paths resolve against `apps/desktop`. Standard-mode builds reject this setting; ambient environment values cannot enable it. The input must contain only this structure, with the deployment's real Bearer keys in place of the example values:

```json
{"version":1,"refs":{"DIZHI_API_KEY":"deployment-dizhi-key","HEZHI_API_KEY":"deployment-hezhi-key"}}
```

The installer contains these extractable credentials and must be distributed within their authorized scope. On startup, the packaged intranet Desktop fills absent or empty entries in `$DSH_HOME/.env` before starting the Host. Existing nonempty home values remain unchanged; Profile dotenv values, keys saved through Models in `.credentials.yaml` and inherited process credentials take precedence. This also repairs an existing installation without replacing its Profile, plugins, projects or sessions. Installers without this opt-in still require target-machine keys.

<a id="installation-and-upgrades"></a>

## Installation and upgrades

The target needs a compatible Desktop runtime and network access to the selected internal service. Configure models independently from enabling the review plugin and Team.

1. Fully quit Desktop and back up `$DSH_HOME/profiles/desktop/cordis.patch.yml`. The default Harness home is the current user's `.dsh` directory.
2. Merge the providers below into the existing `llm-pi-ai.config.providers`. Preserve other routes and adapter settings; add the row only if absent. Do not mount a separate adapter per service: its configurable-provider directory cannot register twice.
3. Replace the existing `agent-default-model` configuration only when changing the deployment default. The example selects Dizhi. For Hezhi, use `hezhi` and `Qwen3.6-27B`.
4. Start Desktop, open Settings → Models, edit each provider, and save its API key through the official credentials service. Keys are stored in the Harness home's `.credentials.yaml`, separately from provider configuration.
5. Restart Desktop and check the model in a new conversation. Existing conversations retain their explicit selection; change it in that conversation's model selector when needed.

An overwrite installation does not reapply Profile seed. A Profile overriding the adapter's full configuration must merge these routes explicitly. Enabling the review plugin does not populate model configuration or credentials. New target machines must configure their own keys unless the authorized installer carries deployment keys as above.

Merge this key-free example into the target Profile:

```yaml
- id: llm-pi-ai
  config:
    providers:
      dizhi:
        displayName: 地质科技
        api: openai-completions
        baseURL: http://10.76.22.59/openai/v1
        apiKeyEnv: DIZHI_API_KEY
        reasoning: 'off'
        compat:
          supportsStore: false
          supportsDeveloperRole: false
          supportsReasoningEffort: false
          supportsUsageInStreaming: false
          maxTokensField: max_tokens
        models:
          - id: gen-studio-Qwen3.6-27B-ygNP
            name: 地质科技 Qwen3.6-27B
            contextWindow: 32768
            maxTokens: 8192
            input: [text]
      hezhi:
        displayName: 核智
        api: openai-completions
        baseURL: http://10.139.133.3:8001/v1
        apiKeyEnv: HEZHI_API_KEY
        reasoning: 'off'
        compat:
          supportsStore: false
          supportsDeveloperRole: false
          supportsReasoningEffort: false
          supportsUsageInStreaming: false
          maxTokensField: max_completion_tokens
          thinkingFormat: chat-template
          chatTemplateKwargs:
            enable_thinking:
              $var: thinking.enabled
        models:
          - id: Qwen3.6-27B
            name: 核智 Qwen3.6-27B
            contextWindow: 32768
            maxTokens: 8192
            input: [text, image]
            reasoningEfforts:
              'off': null
              high: high
- id: agent-default-model
  config:
    provider: dizhi
    model: gen-studio-Qwen3.6-27B-ygNP
    reasoningEffort: 'off'
```

<a id="verification"></a>

## Verification

Verify target-machine routing and ports, then confirm both provider/model IDs and credential status in Settings. A reachable TCP port does not prove authentication or model support.

```powershell
Test-NetConnection -ComputerName 10.76.22.59 -Port 80
Test-NetConnection -ComputerName 10.139.133.3 -Port 8001
```

Run a synthetic-text conversation to verify authentication and streaming. Validate tool calling through a real Team review. Validate vision separately before reviewing images, scanned pages or rendered spreadsheets; Dizhi currently declares text only. Unverified document portions remain `UNVERIFIED`.

For 401/403, check keys and gateway permissions; for 404, check the Base URL prefix and model ID; for parameter errors, check the service-specific output-limit field. Do not fall back to a public service to conceal an intranet failure.

Local mock HTTP, isolated browser snapshots and runtime catalog checks cover configuration behavior. Live inference, streaming, tool calling and vision require acceptance on a machine that can reach the internal endpoints; the development machine could not reach them during integration.

<a id="dev-note"></a>

## Dev Note

None.
