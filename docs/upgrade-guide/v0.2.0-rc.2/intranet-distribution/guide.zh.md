---
kind: upgrade-guide
description: "内网 GUI 部署停用官方账号，并要求在执行模型任务前配置自定义模型。"
---

# 内网 GUI 发行模式

[English](guide.md) | 中文

## 变更

Desktop 和 Web 可采用固定的 `intranet` 发行策略。标准发行模式保留官方集成。内网发行模式无需账号或模型即可进入工作区，隐藏官方登录、额度和账号模型配置，停用官方模型 provider、更新、分析、反馈上传、会话日志上传、搜索和公网插件源探测。可编辑的 profile 配置层无法重新启用这些集成。

已有 profile 保留会话、附件、插件、自定义模型和凭据文件。官方凭据停止使用，不自动删除。旧官方默认模型变为无默认模型。历史模型记录保持不变；打开模型不可用的会话不会恢复其排队任务。发送或恢复前须明确选择一个可用的自定义模型。会话选模仍会更新后续新会话的全局默认模型。

Session API 的 `ModelCatalog.default` 和 `agentDefaultModel.currentSelection()` 现在在未配置默认模型时返回 `null`。默认模型插件允许空配置；否则必须同时提供 `provider` 和 `model`。内网模型任务在派发前拒绝不可用模型。

插件安装支持使用离线依赖解析的本地包，或明确配置的非公网 registry，不回退到公网 registry。此策略控制内置集成和安装入口，不提供操作系统防火墙，也不限制任意插件代码。

## 迁移

1. Web 启动时，在启动进程中导出 `DSH_DISTRIBUTION_MODE=intranet`，再执行 `dsh web`。不要把此启动变量放入运行时 `.env`。构建 Windows Desktop 时，在构建专用的 `apps/desktop/.env.windows` 中设置 `DSH_DISTRIBUTION_MODE=intranet`；打包应用内嵌发行模式，不接受环境变量改为标准模式。参见 [Desktop 构建参考](../../../../apps/desktop/README.zh.md)。
2. 保留现有 Harness 主目录和 profile 文件。在设置 → 模型中配置自建模型端点，再选择可用模型。如需插件依赖，准备离线缓存或配置内网 registry；本地 `.tgz` 安装仍可使用。
3. 更新 `ModelCatalog.default` 和 `currentSelection()` 的外部调用方，以处理 `null`。标准 profile 提供的官方默认模型保持不变。
4. 确认无需登录即可打开工作区，设置中没有官方账号引导，无法选择官方模型，未配置模型时执行任务会提示选模错误。重新打开旧会话，确认历史仍可阅读，再选择替代模型。
