# ZX AI 2.0 · 工作台、Finance 与项目实验台

项目已整合 Claude UI、本机 SQLite 财务 API，并接入真正的本地流式聊天。保留浅色/深色主题、手机底部导航、三步记账和原项目管理功能。**AI 助手仅调用本机 Ollama；云端与付费 API 保持关闭。**

## 已接通的功能

- Finance 默认通过 `src/finance/httpApi.ts` 调用同源 HTTP API。新数据库只有常用分类，账户、负债与流水均为空；不会自动导入 UI 演示资产或金额。
- 添加账户和初始余额；记录支出、收入、现金账户间转账；修改与删除记录后由服务端从初始余额和全部流水重新计算。
- 还款 API 同时减少现金、负债和本期应还，不计消费。新增负债界面与 API 尚未开放，因此新空账本暂不能在界面录入负债。
- 月度总预算、分类预算，财务明细筛选、搜索和前端 CSV 导出。后端支持退款冲减消费；当前三步记账只提供支出、收入、转账。
- 交易与还款使用持久化 `Idempotency-Key`，同请求重放只记一次；不同请求复用同键返回 409。账务修改、审计和幂等凭证在同一事务提交。
- 项目实验台：本地 Qwen3 生成结构化任务、提示词预览、搜索历史、任务勾选、复盘、并发版本保护、取消、删除、Markdown 导出和明确标注的人工教学示例。
- 原实验台通过开放 Shadow DOM 隔离样式。切换模块会保留尚未保存的实验台复盘；刷新/关闭页面仍需先保存。
- 关键词“一句话记账”只生成规则提案，确认后才按手动记录保存；它没有调用 AI。模型不会自行写账。
- AI 助手：Qwen3、DeepSeek R1 和 Kimi Linear 本地模型目录，真实安装/连接/下载状态，流式回复、停止、复制、失败重问、SQLite 会话历史和删除。未完成下载的模型不能发送消息。

## 本地运行

需要 Node.js **24.x**（包含内置 TypeScript 和 SQLite）及 npm。聊天迭代分支为 `feat/zx-ai-model-center-chat`，基于 `feat/zx-ai-2-ui-finance-integration`，未合并到 main。

```powershell
git clone --branch feat/zx-ai-model-center-chat https://github.com/andychen1314424-cloud/my-first-ai.git
cd my-first-ai
npm install
npm run build
npm start
```

打开 **http://127.0.0.1:4173**。第一次进入 Finance → 资产 → 添加账户，输入你确认过的初始余额，再记第一笔。保留终端运行，Ctrl+C 停止服务。已有构建和依赖的本次本地交付可直接运行 `node server/index.ts`。

开发时运行 `npm run dev`，访问 http://127.0.0.1:5173。前端 Vite 代理到本机 4173 后端。两种方式均只监听 `127.0.0.1`，不是手机或公网访问地址。不会自动开启隧道、修改防火墙或公开部署。

默认项目数据为 `.data/projects.sqlite`，财务为 `.data/finance.sqlite`，聊天为 `.data/chat.sqlite`；可设置 `ZX_DATA_DIR` 改目录，`ZX_PORT` 改生产预览端口。**下载仓库不会带回你原电脑上的数据库**；如使用已有项目库，先备份，再显式设置 `ZX_DATA_DIR` 指向原目录，或停服后迁移数据。不要用演示数据替换自己的账本。

## 模型与演示边界

“项目实验台”保留原来的真实 Ollama 接口，默认只连接 `http://127.0.0.1:11434`。模型白名单仍为 `qwen3:1.7b`、`qwen3:4b`、`qwen3:8b`，未修改本地模型限制。需安装并启动 Ollama，下载其中一个本地模型后，进入实验台点“刷新连接”。已有的模型、服务与旧版 ZX AI 聊天项目未被替换。

“AI 助手”使用独立的本地 Provider 和聊天白名单，支持 Qwen3 1.7B/4B/8B、DeepSeek R1 1.5B/8B 蒸馏模型，以及 Kimi Linear 48B-A3B 的 bartowski 社区 Q4_K_M GGUF。只有实际安装的本地权重可选；Ollama 远程模型、`:cloud`、非回环地址和重定向均拒绝。原实验台仍保持原来的 Qwen3 白名单。

助手回复为真实模型生成，不再使用演示模板。会话和每条回复所用模型保存到 SQLite；停止/网络断开会保留已收到的部分，超时、输出截断和空答案明确标记失败。消息请求 ID 防止不确定网络结果导致重复生成。上下文只传最近最多 10 个完整轮次且正文合计不超过 12000 字符，更早历史仍可查看。

2026-10-27 本机状态：DeepSeek 8B 与 Kimi 的权重均已下载并安装到 D 盘。DeepSeek 8B 已经通过本网站真实聊天接口完成回复并持久化，约 22.17 秒。Kimi 曾因 CUDA 主机内存分配失败无法启动；现已加入 CPU 内存映射配置（`num_gpu: 0`、`use_mmap: true`），保持 16K token 上下文，默认最长等待 15 分钟，可随时停止。直接 Ollama 的 CPU 短答诊断曾在约 44.797 秒成功，但修复后的网站真实聊天验收仍待完成；目前 Ollama 模型发现异常，不能据此声称 Kimi 已在网站可用。

聊天暂未接财务工具或文件/联网能力，不会自动把真实账本发给模型。自然语言记账仍为规则提案；用户确认后才保存。模型目录、D 盘配置、下载和推理验证边界见 [本地 AI 说明](docs/LOCAL-AI.md)。

本轮无云端 Provider 实现、无云端请求、无付费回退。DeepSeek / Kimi / Qwen 云端扩展仍需单独确认数据发送范围与费用后实施。

## 账务与安全范围

金额全部为安全整数分，日期 `YYYY-MM-DD`。转账不计收支；还款不计消费；退款冲减消费。投资、借入、借出与收回交易尚未具备持仓/借贷模型，后端明确拒绝这些类型。投资等账户的初始余额可展示，不能据此认为已实现投资买卖或损益计算。

余额、还款和完整性由服务端约束；图表、收支汇总、资金可支撑时间仍使用前端确定性函数，后者会显示假设。当前未提供服务端统计报告或财务 AI 工具。允许现金负余额以录入历史/透支，不会自动生成相应负债。

保留本机限制与 Host/Origin 校验。用户于 2026-10-26 明确批准本地 DeepSeek 与 Kimi，因此 `AGENTS.md` 追加聊天专用白名单范围；原实验台白名单和回环绑定保持。本轮未完成账号登录、多用户权限、限流和 HTTPS 部署；**不得将当前服务或真实账本暴露到外网**。数据库及备份未加密，仅依赖电脑文件权限。详细账务、审计、迁移、备份和恢复边界见 [存储说明](docs/FINANCE-STORAGE.md)。

手动一致性备份：

```powershell
node scripts/finance-backup.ts
```

备份保存到 `.data/backups/`，使用 SQLite online backup 并检查完整性。空库回滚可加 `--rollback-empty`，已有业务数据时拒绝破坏性降级；业务恢复采用停服并恢复已验证备份，步骤见存储说明。

## 验证

```powershell
npm run typecheck
npm run check
npm run test:e2e
```

`check` 包含前端构建和 Node 测试。`test:e2e` 使用临时 SQLite 与明确标注的 Ollama 协议 fixture；fixture 不是实测模型。2026-10-27 的 CPU 映射修复已通过 43 项 Node 测试和 11 项浏览器测试，包含 Kimi 专属参数、财务和原实验台回归。首次运行需已有 Playwright Chromium，或设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指向 Chrome/Edge 可执行文件。

实测结果与局限见 [本轮验收记录](docs/INTEGRATION-VERIFICATION.md)。手机验证是 Chromium 390px 视口，不等于真实 iPhone Safari / Android 验收。

[迭代清单](docs/ROADMAP.md) · [原实验台架构](docs/ARCHITECTURE.md) · [学习练习](docs/LEARNING.md)
