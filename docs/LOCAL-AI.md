# 免费本地模型与真实聊天

2026-10-26，用户明确要求只用本地 DeepSeek 和 Kimi，不使用付费服务，并将模型文件放到 D 盘。本轮实现独立本地 Provider、模型中心、真正流式聊天和 SQLite 会话历史。没有云端 Provider、API Key 输入或付费回退。

## 模型与来源

| 网站型号 | Ollama ID | 来源与边界 |
| --- | --- | --- |
| Qwen3 1.7B / 4B / 8B | `qwen3:1.7b` / `qwen3:4b` / `qwen3:8b` | 本地 Qwen3 权重 |
| DeepSeek R1 1.5B 蒸馏版 | `deepseek-r1:1.5b` | DeepSeek-R1-Distill-Qwen-1.5B |
| DeepSeek R1 8B 蒸馏版 | `deepseek-r1:8b` | 当前 Ollama tag 对应 DeepSeek-R1-0528-Qwen3-8B，Q4_K_M，约 5.2 GB；不等同于大参数本体 |
| Kimi Linear 48B-A3B | `hf.co/bartowski/moonshotai_Kimi-Linear-48B-A3B-Instruct-GGUF:Q4_K_M` | Moonshot 官方 Kimi Linear 模型的 bartowski 社区 GGUF 量化，约 30.06 GB；不是 Kimi 云端旗舰 |

型号依据 [Ollama DeepSeek 页面](https://ollama.com/library/deepseek-r1:8b)、[Moonshot 官方模型卡](https://huggingface.co/moonshotai/Kimi-Linear-48B-A3B-Instruct) 和 [量化文件发布页](https://huggingface.co/bartowski/moonshotai_Kimi-Linear-48B-A3B-Instruct-GGUF)。没有将 `:cloud` 模型作为本地替代。

本机实测：已安装的 DeepSeek R1 1.5B 通过本网站真实聊天 HTTP 接口完成中文回答，约 3 秒，随后从 SQLite 读回完整会话。DeepSeek 8B 与 Kimi 是后台大文件下载，模型目录会持续显示实际进度；未完成下载和安装之前禁止选择。下载成功、安装可发现、实际生成成功是三个不同状态，后续推理验收应逐项记录。

本机 Qwen3 4B 的旧模板会强制开启思考。Provider 保留 Ollama 原生思考/正文分离、忽略 thinking 字段，并仅在模型载荷追加官方 `/no_think` 软开关（SQLite 用户原文不变）；实测返回简短的最终中文答案，约 9.46 秒。思考预算与回答预算共用，因此 Qwen 设为 4096 输出 token；到上限仍返回错误，不能把截断当成功。没有用中文关键词启发式删减模型正文。

## D 盘存储

本次电脑实际存储为 `D:\Ollama\models`，用户级 `OLLAMA_MODELS` 已设置为该目录。迁移时暂停相关下载与 Ollama，逐文件比较 92 项内容的长度及 SHA-256，验证原有 6 个模型仍存在，并从 `/api/show` 确认模型 `FROM` 路径在 D 盘，再删除旧副本。`C:\Users\1\.ollama\models` 仅为兼容旧环境的目录链接，权重和续传分片实际位于 D 盘。

其他电脑可将 `OLLAMA_MODELS` 设置为自己的模型目录，并完全退出/重新启动 Ollama，使实际服务进程读取新变量。仅改变客户端终端变量、日志目录或安装程序位置，不代表已改变权重存储。迁移前需保留既有模型并核验，不要直接删除旧目录。

模型权重、下载 partial、进程状态、数据库均不提交 Git。应用不会自动执行模型安装命令；模型中心只提供复制，用户自行选择下载。当前本机的后台下载由本轮受用户授权的独立进程执行。

应用可选读取数据目录 `model-downloads/` 中两个固定名称的状态 JSON：`deepseek-r1-8b.json` 和 `kimi-linear-48b-bartowski.json`。记录必须匹配模型 ID、有效大小和最近更新时间，才展示进度；过期记录不声称仍在下载。本机此目录链接到 D 盘的任务状态目录。没有状态文件的其他安装仍正常显示 Ollama 的安装情况。

## 会话与请求边界

- `GET /api/ai/status`：本地模型目录、安装/连接/下载状态，`cloudEnabled: false`。
- `GET/POST /api/chat/conversations`：读取、新建会话；`GET/PATCH/DELETE /:id`：读取、改标题、删除。
- `POST /api/chat/conversations/:id/messages`：`{text,modelId,requestId}`，响应 NDJSON 的 start/delta/done/error。
- SQLite 保存到 `.data/chat.sqlite`（或 `ZX_DATA_DIR`），短事务保存成对消息与请求记录。500ms checkpoint 保留部分输出；停止/断开/重启后明确标记未完成。
- 同请求 ID 同内容重放不重复推理，异内容返回 409；删除对话时只保留无正文的请求 ID 墓碑，旧请求返回 410，不恢复已删文字。
- 单次输入最多 6000 字符，一次仅一条生成；上下文最近最多 10 完整轮且总正文不超过 12000 字符；回复最多 65536 字符，超时及 token 截断标记错误。
- 只向数值 `127.0.0.1` 的 Ollama 发送请求，禁止重定向。生成前核验 `/api/tags` 和 `/api/show`，拒绝远程代理和云端 tag。保留 Host/Origin 与同源 CSP。
- 暂不自动查询或修改财务数据、读取文件、联网搜索或执行命令。聊天文字和代码按 React 文本节点展示，模型 HTML 不执行。

## 参考与优化顺序

参考 [Ollama 流式聊天协议](https://docs.ollama.com/api/chat) 和 [Open WebUI 模型选择设计](https://docs.openwebui.com/features/workspace/models/)，本轮优先补齐真实模型状态、模型切换、停止、失败重问、代码/答案复制和持久化历史，避免仅靠“开发中”占位。

后续建议：先做只读财务查询工具（数字由程序计算），再接必须用户确认的记账提案；其次是本地文件知识库及来源引用、会话导出与备份恢复、可见的上下文管理。公开访问仍需另行完成认证、权限、限流和 HTTPS；用户本轮没有要求开放公网。

自动化验收：42 项 Node 测试和 11 项 Chromium 浏览器测试通过，覆盖聊天、跨窗口生成状态同步、财务及原实验台。协议 fixture 只验证程序行为，不能替代每个大模型的真实推理验收。390px 手机视口通过，不等同真实 iOS/Android 验收。
