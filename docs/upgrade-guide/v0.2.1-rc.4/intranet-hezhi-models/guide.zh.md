---
kind: upgrade-guide
description: "移除内置核智 Qwen provider，并更改核智 DeepSeek 地址。"
---

# 内网核智模型配置

[English](guide.md) | 中文

## 变更

内网模型目录不再包含 `hezhi` / `Qwen3.6-27B`。`hezhi-dsv4` provider 改用 `http://10.139.133.3:8001/hz_model_dpsk/v1`。Profile 覆盖配置和已保存的模型选择仍优先于内置默认值。

## 迁移

1. 如果 `$DSH_HOME/profiles/desktop/cordis.patch.yml` 覆盖了 `llm-pi-ai`，删除其中的 `hezhi` provider，并将 `hezhi-dsv4` 的 `baseURL` 改为 `http://10.139.133.3:8001/hz_model_dpsk/v1`。其他覆盖 provider 配置的 Profile 或 overlay 也需作相同修改。
2. 将使用 `hezhi` / `Qwen3.6-27B` 的已保存默认模型或会话选择切换为可用模型。重启桌面版，在“设置 → 模型”中检查 provider 列表和地址。
3. 新部署密钥文件需要 `DIZHI_API_KEY` 和 `HEZHI_DSV4_API_KEY`。旧文件可保留 `HEZHI_API_KEY`，写入凭据时会忽略该字段。
