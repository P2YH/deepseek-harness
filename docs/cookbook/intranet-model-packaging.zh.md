# 内网模型打包与配置

[English](intranet-model-packaging.md) | 中文

## 摘要

在内网 Windows 桌面版接入地质科技和核智，无需官方账号。两种服务复用现有 pi-ai 适配器。安装器携带端点配置和凭据引用，各目标机器单独保存 API Key。

## 目录

- [接口](#endpoints)
- [打包](#packaging)
- [安装与升级](#installation-and-upgrades)
- [验收](#verification)
- [开发备注](#dev-note)

<a id="endpoints"></a>

## 接口

配置中使用下表的 Base URL，不追加 `/chat/completions`；适配器会追加该后缀。保留地质科技的 `/openai/v1` 前缀和精确模型 ID。

| 字段 | 地质科技 | 核智 |
| --- | --- | --- |
| Provider ID | `dizhi` | `hezhi` |
| 模型 ID | `gen-studio-Qwen3.6-27B-ygNP` | `Qwen3.6-27B` |
| Base URL | `http://10.76.22.59/openai/v1` | `http://10.139.133.3:8001/v1` |
| 凭据引用 | `DIZHI_API_KEY` | `HEZHI_API_KEY` |
| 输出限制字段 | `max_tokens` | `max_completion_tokens` |
| 思考参数 | 未配置 | `chat_template_kwargs.enable_thinking` |
| 输入声明 | 文本 | 文本、图片；视觉能力未实测 |

两条 route 均使用 `openai-completions` 和 Bearer 认证。地质不覆盖容量，继承官方适配器默认值，目前为 262144/32768 上下文/输出 token；SDK 可根据剩余上下文缩减输出额度。核智保留 32768/8192 token 的临时部署配置。这些默认值和临时配置均不代表已验证的服务端限制。

<a id="packaging"></a>

## 打包

按[桌面版打包步骤](../../apps/desktop/README.zh.md#release-versions)操作，在构建配置中设置 `DSH_DISTRIBUTION_MODE=intranet`。[Web bundle patch](../../packages/bundle/web-app/cordis.patch.yml)负责这些内网 provider 默认配置。检查 prepared runtime 和最终 ASAR 包含更新后的 patch 与官方适配器。修改开发机 Profile 不会更新安装器。

当前源码组合默认核智。如需新安装默认地质科技，将 bundle patch 中 `agent-default-model` 的内网分支改为 `dizhi` 和 `gen-studio-Qwen3.6-27B-ygNP`，保留标准模式分支，并更新对应测试。已有 Profile 保存的选择仍优先。

本地安装器 `0.2.0-rc.2.20261008.1` 早于这两种 provider 的接入，需按下文配置 Profile 或重新构建。常规构建不包含密钥。经授权的内网部署可按下文仅预置两个模型的密钥；不要将开发机凭据文件或整个 Harness home 打入安装器。

### 可选的部署密钥

如需经授权的内网安装器免填写密钥，在 `apps/desktop/.env.windows` 中设置 `DSH_DESKTOP_INTRANET_MODEL_KEYS_FILE`，指向源码目录以外的私有 JSON 文件。相对路径以 `apps/desktop` 为基准。标准模式拒绝此设置，启动环境中的同名变量不会启用它。输入仅允许以下结构，将示例值替换为部署所用的真实 Bearer 密钥：

```json
{"version":1,"refs":{"DIZHI_API_KEY":"deployment-dizhi-key","HEZHI_API_KEY":"deployment-hezhi-key"}}
```

安装器包含可提取的凭据，应在其授权范围内分发。内网桌面启动 Host 前，将缺失或为空的密钥补入 `$DSH_HOME/.env`。已有非空 home 值保持不变；Profile 的 dotenv 值、通过模型设置保存到 `.credentials.yaml` 的密钥以及继承的进程凭据优先。这也可修复已有安装，无需替换其 Profile、插件、项目或会话。未启用此选项的安装器仍需在目标机配置密钥。

<a id="installation-and-upgrades"></a>

## 安装与升级

目标环境需要兼容的桌面运行时，并能访问所选内网服务。模型配置与评审插件、Team 的启用分别操作。

1. 完全退出桌面版，备份 `$DSH_HOME/profiles/desktop/cordis.patch.yml`。默认 Harness home 为当前用户的 `.dsh` 目录。
2. 将下方 provider 合并到已有 `llm-pi-ai.config.providers`，保留其他 route 和适配器参数；没有该行才新增。不要为每个服务另装适配器：可配置 provider 目录不能重复注册。
3. 仅在更改部署默认时替换已有 `agent-default-model` 配置。示例默认地质科技；核智使用 `hezhi` 和 `Qwen3.6-27B`。
4. 启动桌面版，进入“设置 → 模型”，分别编辑 provider，通过官方凭据服务保存 API Key。密钥保存在 Harness home 的 `.credentials.yaml`，与 provider 配置分开存储。
5. 重启桌面版，在新建会话中检查模型。已有会话保留显式选择；需要时在该会话的模型选择器中切换。

覆盖安装不会重新应用 Profile seed。覆盖了适配器完整配置的 Profile 需要显式合并两条 route。启用评审插件不自动写入模型配置或凭据。除非安装器按上文携带经授权的部署密钥，新目标机器必须单独配置密钥。

要让地质继承官方适配器默认值，需从 Profile 覆盖配置中的该模型删除原有临时 `contextWindow: 32768` 与 `maxTokens: 8192` 字段。不修改适配器常量或剩余上下文计算。日志中标记为适配器默认值的字段会在下次请求重新解析；显式 Agent 与 Session 输出设置仍优先。

将下面不含密钥的示例合并到目标 Profile：

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

## 验收

核验目标机器路由和端口，再在设置中确认两种 provider、模型 ID 和凭据状态。TCP 端口可达不证明认证或模型能力正常。

```powershell
Test-NetConnection -ComputerName 10.76.22.59 -Port 80
Test-NetConnection -ComputerName 10.139.133.3 -Port 8001
```

用合成文本对话验证认证和流式回复，通过真实 Team 评审验证工具调用。图片、扫描页和电子表格渲染核读前须另测视觉能力；地质科技目前仅声明文本输入。未核验的文档部分保持 `UNVERIFIED`。

401/403 检查密钥和网关权限；404 检查 Base URL 前缀及模型 ID；参数错误检查各服务不同的输出限制字段。不要用公网服务回退掩盖内网失败。

本地模拟 HTTP、隔离网页快照和运行时 catalog 检查覆盖配置行为。真实推理、流式服务、工具调用和视觉能力需在可访问内网端点的机器上验收；开发机在接入时无法连通这些端点。

<a id="dev-note"></a>

## 开发备注

无。
