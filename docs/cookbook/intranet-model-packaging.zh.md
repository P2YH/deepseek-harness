# 内网模型打包与配置

[English](intranet-model-packaging.md) | 中文

## 摘要

在内网 Windows 桌面版接入地质科技和核智 DeepSeek，无需官方账号。所有服务复用现有 pi-ai 适配器。安装器携带端点配置和凭据引用，各目标机器单独保存 API Key。

## 目录

- [接口](#endpoints)
- [打包](#packaging)
- [安装与升级](#installation-and-upgrades)
- [验收](#verification)
- [开发备注](#dev-note)

<a id="endpoints"></a>

## 接口

配置中使用下表的 Base URL，不追加 `/chat/completions`；适配器会追加该后缀。保留地质科技的 `/openai/v1` 前缀和精确模型 ID。

| 字段 | 地质科技 | 核智 DeepSeek V4 |
| --- | --- | --- |
| Provider ID | `dizhi` | `hezhi-dsv4` |
| 模型 ID | `gen-studio-Qwen3.6-27B-ygNP` | `dsv4` |
| Base URL | `http://10.76.22.59/openai/v1` | `http://10.139.133.3:8001/hz_model_dpsk/v1` |
| 凭据引用 | `DIZHI_API_KEY` | `HEZHI_DSV4_API_KEY` |
| 输出限制字段 | `max_tokens` | `max_tokens` |
| 思考参数 | `chat_template_kwargs.enable_thinking`（默认 `false`） | 未配置 |
| 输入声明 | 文本 | 文本 |

两条 route 均使用 `openai-completions` 和 Bearer 认证。地质不覆盖容量，继承官方适配器默认值，目前为 262144/32768 上下文/输出 token；SDK 可根据剩余上下文缩减输出额度。dsv4 route 使用适配器回退容量。这些默认值不代表已验证的服务端限制。

<a id="packaging"></a>

## 打包

按[桌面版打包步骤](../../apps/desktop/README.zh.md#release-versions)操作，在构建配置中设置 `DSH_DISTRIBUTION_MODE=intranet`。[Web bundle patch](../../packages/bundle/web-app/cordis.patch.yml)负责这些内网 provider 默认配置。检查 prepared runtime 和最终 ASAR 包含更新后的 patch 与官方适配器。修改开发机 Profile 不会更新安装器。

当前源码组合在内网模式默认地质科技。已有 Profile 保存的选择仍优先。

常规构建不包含密钥。经授权的内网部署可按下文仅预置两个模型的密钥；不要将开发机凭据文件或整个 Harness home 打入安装器。

### 可选的部署密钥

如需经授权的内网安装器免填写密钥，在 `apps/desktop/.env.windows` 中设置 `DSH_DESKTOP_INTRANET_MODEL_KEYS_FILE`，指向源码目录以外的私有 JSON 文件。相对路径以 `apps/desktop` 为基准。标准模式拒绝此设置，启动环境中的同名变量不会启用它。输入仅允许以下结构，将示例值替换为部署所用的真实 Bearer 密钥：

```json
{"version":1,"refs":{"DIZHI_API_KEY":"deployment-dizhi-key","HEZHI_DSV4_API_KEY":"deployment-hezhi-dsv4-key"}}
```

安装器包含可提取的凭据，应在其授权范围内分发。内网桌面启动 Host 前，将缺失或为空的密钥补入 `$DSH_HOME/.env`。已有非空 home 值保持不变；Profile 的 dotenv 值、通过模型设置保存到 `.credentials.yaml` 的密钥以及继承的进程凭据优先。这也可修复已有安装，无需替换其 Profile、插件、项目或会话。未启用此选项的安装器仍需在目标机配置密钥。

<a id="installation-and-upgrades"></a>

## 安装与升级

目标环境需要兼容的桌面运行时，并能访问所选内网服务。模型配置与评审插件、Team 的启用分别操作。

1. 完全退出桌面版，备份 `$DSH_HOME/profiles/desktop/cordis.patch.yml`。默认 Harness home 为当前用户的 `.dsh` 目录。
2. 将下方 provider 合并到已有 `llm-pi-ai.config.providers`，保留其他 route 和适配器参数；没有该行才新增。不要为每个服务另装适配器：可配置 provider 目录不能重复注册。
3. 仅在更改部署默认时替换已有 `agent-default-model` 配置。内网默认地质科技；核智 DeepSeek 使用 `hezhi-dsv4` 和 `dsv4`。
4. 启动桌面版，进入“设置 → 模型”，分别编辑 provider，通过官方凭据服务保存 API Key。密钥保存在 Harness home 的 `.credentials.yaml`，与 provider 配置分开存储。
5. 重启桌面版，在新建会话中检查模型。已有会话保留显式选择；需要时在该会话的模型选择器中切换。

覆盖安装不会重新应用 Profile seed。覆盖了适配器完整配置的 Profile 需要显式合并两条 route。启用评审插件不自动写入模型配置或凭据。除非安装器按上文携带经授权的部署密钥，新目标机器必须单独配置密钥。

要让地质继承官方适配器默认值，需从 Profile 覆盖配置中的该模型删除原有临时 `contextWindow: 32768` 与 `maxTokens: 8192` 字段。不修改适配器常量或剩余上下文计算。日志中标记为适配器默认值的字段会在下次请求重新解析；显式 Agent 与 Session 输出设置仍优先。

Qwen 还需同时合并下方 `compat.thinkingFormat: qwen-chat-template` 与模型的 `reasoningEfforts`。没有声明思考能力和请求格式时，仅设置 provider 的 `reasoning: 'off'` 不会发送关闭思考的参数。关闭时发送 `enable_thinking: false`，显式选择高时发送 `true`。网关和模型服务必须支持此 chat-template 参数；已有会话若显式开启了思考，需在该会话选择关闭。

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
          thinkingFormat: qwen-chat-template
        models:
          - id: gen-studio-Qwen3.6-27B-ygNP
            name: 地质科技 Qwen3.6-27B
            input: [text]
            reasoningEfforts: { off: null, high: high }
      hezhi-dsv4:
        displayName: 核智 DeepSeek
        api: openai-completions
        baseURL: http://10.139.133.3:8001/hz_model_dpsk/v1
        apiKeyEnv: HEZHI_DSV4_API_KEY
        reasoning: 'off'
        compat:
          supportsStore: false
          supportsDeveloperRole: false
          supportsReasoningEffort: false
          supportsUsageInStreaming: false
          maxTokensField: max_tokens
        models:
          - id: dsv4
            name: deepseek-v4-flash
            input: [text]
- id: agent-default-model
  config:
    provider: dizhi
    model: gen-studio-Qwen3.6-27B-ygNP
    reasoningEffort: 'off'
```

<a id="verification"></a>

## 验收

核验目标机器路由和端口，再在设置中确认两个 provider、模型 ID 和凭据状态。TCP 端口可达不证明认证或模型能力正常。

```powershell
Test-NetConnection -ComputerName 10.76.22.59 -Port 80
Test-NetConnection -ComputerName 10.139.133.3 -Port 8001
```

用合成文本对话验证认证和流式回复，通过真实 Team 评审验证工具调用。图片、扫描页和电子表格渲染核读前须另测视觉能力；地质科技目前仅声明文本输入。未核验的文档部分保持 `UNVERIFIED`。

将 Qwen 思考设为关闭，确认实际请求带有 `chat_template_kwargs.enable_thinking: false`，并通过 PPT 内容稿或 SVG 任务确认出现正文或工具操作。如果仍然只输出思考、没有正文和工具操作就达到输出上限，需先核验服务端是否执行该开关，再重试任务。仅新建会话不会改变 provider 配置。

401/403 检查密钥和网关权限；404 检查 Base URL 前缀及模型 ID；参数错误检查各服务不同的输出限制字段。不要用公网服务回退掩盖内网失败。

本地模拟 HTTP、隔离网页快照和运行时 catalog 检查覆盖配置行为。真实推理、流式服务、工具调用和视觉能力需在可访问内网端点的机器上验收；开发机在接入时无法连通这些端点。

<a id="dev-note"></a>

## 开发备注

无。
