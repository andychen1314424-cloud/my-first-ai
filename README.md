# ZX AI 2.0 · 工作台、Finance 与项目实验台

本轮整合 Claude 的 UI 阶段源码，并接入本机 SQLite 财务 API。保留浅色/深色主题、手机底部导航、三步记账和原项目管理功能。**本轮范围是前端整合 + 首批真实财务接口，AI 助手聊天仍是标记清楚的演示回复。**

## 已接通的功能

- Finance 默认通过 `src/finance/httpApi.ts` 调用同源 HTTP API。新数据库只有常用分类，账户、负债与流水均为空；不会自动导入 UI 演示资产或金额。
- 添加账户和初始余额；记录支出、收入、现金账户间转账；修改与删除记录后由服务端从初始余额和全部流水重新计算。
- 还款 API 同时减少现金、负债和本期应还，不计消费。新增负债界面与 API 尚未开放，因此新空账本暂不能在界面录入负债。
- 月度总预算、分类预算，财务明细筛选、搜索和前端 CSV 导出。后端支持退款冲减消费；当前三步记账只提供支出、收入、转账。
- 交易与还款使用持久化 `Idempotency-Key`，同请求重放只记一次；不同请求复用同键返回 409。账务修改、审计和幂等凭证在同一事务提交。
- 项目实验台：本地 Qwen3 生成结构化任务、提示词预览、搜索历史、任务勾选、复盘、并发版本保护、取消、删除、Markdown 导出和明确标注的人工教学示例。
- 原实验台通过开放 Shadow DOM 隔离样式。切换模块会保留尚未保存的实验台复盘；刷新/关闭页面仍需先保存。
- 关键词“一句话记账”只生成规则提案，确认后才按手动记录保存；它没有调用 AI。模型不会自行写账。

## 本地运行

需要 Node.js **24.x**（包含内置 TypeScript 和 SQLite）及 npm。此分支为 `feat/zx-ai-2-ui-finance-integration`，基于 `feat/zx-ai-project-lab`，未合并到 main。

```powershell
git clone --branch feat/zx-ai-2-ui-finance-integration https://github.com/andychen1314424-cloud/my-first-ai.git
cd my-first-ai
npm install
npm run build
npm start
```

打开 **http://127.0.0.1:4173**。第一次进入 Finance → 资产 → 添加账户，输入你确认过的初始余额，再记第一笔。保留终端运行，Ctrl+C 停止服务。已有构建和依赖的本次本地交付可直接运行 `node server/index.ts`。

开发时运行 `npm run dev`，访问 http://127.0.0.1:5173。前端 Vite 代理到本机 4173 后端。两种方式均只监听 `127.0.0.1`，不是手机或公网访问地址。不会自动开启隧道、修改防火墙或公开部署。

默认项目数据为 `.data/projects.sqlite`，财务为 `.data/finance.sqlite`；可设置 `ZX_DATA_DIR` 改目录，`ZX_PORT` 改生产预览端口。**下载仓库不会带回你原电脑上的数据库**；如使用已有项目库，先备份，再显式设置 `ZX_DATA_DIR` 指向原目录，或停服后迁移数据。不要用演示数据替换自己的账本。

## 模型与演示边界

“项目实验台”保留原来的真实 Ollama 接口，默认只连接 `http://127.0.0.1:11434`。模型白名单仍为 `qwen3:1.7b`、`qwen3:4b`、`qwen3:8b`，未修改本地模型限制。需安装并启动 Ollama，下载其中一个本地模型后，进入实验台点“刷新连接”。已有的模型、服务与旧版 ZX AI 聊天项目未被替换。

“AI 助手”仍由前端演示模板回复，显示“演示回复”；不是连接已安装模型的真实聊天。聊天历史目前是浏览器 localStorage；真实流式聊天、服务端聊天历史、统一 Provider、`deepseek-r1:8b` 与自然语言记账模型接口留待下一轮。不会把本地蒸馏模型标记为官方满血版。

本轮无云端 Provider 实现、无云端请求、无付费回退。DeepSeek / Kimi / Qwen 云端扩展仍需单独确认数据发送范围与费用后实施。

## 账务与安全范围

金额全部为安全整数分，日期 `YYYY-MM-DD`。转账不计收支；还款不计消费；退款冲减消费。投资、借入、借出与收回交易尚未具备持仓/借贷模型，后端明确拒绝这些类型。投资等账户的初始余额可展示，不能据此认为已实现投资买卖或损益计算。

余额、还款和完整性由服务端约束；图表、收支汇总、资金可支撑时间仍使用前端确定性函数，后者会显示假设。当前未提供服务端统计报告或财务 AI 工具。允许现金负余额以录入历史/透支，不会自动生成相应负债。

保留原 `AGENTS.md` 的本机限制与 Host/Origin 校验，未变更任何限制。本轮未完成账号登录、多用户权限、限流和 HTTPS 部署；**不得将当前服务或真实账本暴露到外网**。数据库及备份未加密，仅依赖电脑文件权限。详细账务、审计、迁移、备份和恢复边界见 [存储说明](docs/FINANCE-STORAGE.md)。

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

`check` 包含前端构建和 Node 测试。`test:e2e` 使用临时 SQLite 与明确标注的 Ollama 协议 fixture；fixture 不是实测模型。首次运行需已有 Playwright Chromium，或设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指向 Chrome/Edge 可执行文件。

实测结果与局限见 [本轮验收记录](docs/INTEGRATION-VERIFICATION.md)。手机验证是 Chromium 390px 视口，不等于真实 iPhone Safari / Android 验收。

[迭代清单](docs/ROADMAP.md) · [原实验台架构](docs/ARCHITECTURE.md) · [学习练习](docs/LEARNING.md)
