# Doris MCP 分阶段接入路线

## 当前决策

当前不部署 Apache Doris，也不修改生产数据流。MySQL 继续作为任务、日志、笔记和附件元数据的唯一事实源；现有任务台 MCP 继续提供读取能力和带审批的写操作；LlamaIndex/Qdrant 继续用于语义召回。

系统通过 `npm run check:system` 统计分析数据规模并评估 Doris 启用条件。命中条件只会提示启动试点评估，不会自动安装、同步或切换数据库。

## 启用条件

满足以下任一条件时进入试点，未满足时继续使用 MySQL：

- 可分析记录达到 1,000,000 行。
- 外部数据源达到 3 个。
- 复杂报表 P95 延迟持续高于 2,000ms。
- 已形成固定的趋势分析、长期统计或多维聚合需求。

当前系统能自动统计数据行数。外部数据源数量、报表 P95 和固定分析需求在试点前由维护者确认，不依赖模型自行判断。

## 数据与路由边界

| 请求类型 | 当前数据源 | Doris 启用后 |
| --- | --- | --- |
| 任务状态、最新日志、日报/周报 | MySQL | 仍使用 MySQL |
| 笔记、OCR、附件内容检索 | MySQL + LlamaIndex/Qdrant | 保持不变 |
| 创建或修改任务、日志、笔记 | MySQL 审批队列 | 保持不变 |
| 趋势、长期统计、跨系统聚合 | MySQL | Doris MCP |

允许同步到 Doris 的字段：任务状态、优先级、进度、日期、日志工时、分类、附件类型和大小、AI 调用数量及耗时统计。

禁止同步到 Doris 的内容：密码、API Key、会话密钥、完整笔记正文、附件二进制、微信临时文件、附件原始 OCR 全文和未脱敏的对话正文。

## 未来试点实施

1. 在独立分析服务器部署 Doris 4.1 或更高版本，创建分析数据库和只读 MCP 账号。
2. 使用 Doris 内置 MySQL Streaming Job 做全量加增量同步，不部署 Flink；MySQL 使用独立 CDC 账号并开启 ROW/FULL Binlog。
3. 建立当前状态表和事件事实表：`dim_task_current`、`fact_work_activity`、`fact_attachment_event`、`fact_ai_usage_daily`。
4. 部署 `doris-mcp-server`，仅开放 `doris_catalog`、`doris_query` 和需要的分析子能力；HTTP 监听回环地址并使用独立 Token。
5. 通过 HTTPS 反向代理暴露独立 MCP 路径。OpenClaw 同时连接任务台 MCP 和 Doris MCP，禁止共用凭据。
6. AI 路由只把趋势和聚合请求发送到 Doris MCP。Doris 不可用或同步延迟超限时回退 MySQL，并明确提示分析数据可能不完整。

## 试点验收

- MySQL 与 Doris 的任务数量、日志工时、状态分布和软删除结果一致。
- 增删改数据在约定同步延迟内可见，乱序更新不会覆盖新数据。
- Doris MCP 无法执行写 SQL，也无法读取禁止同步的字段。
- 实时任务问题始终走 MySQL，趋势问题才走 Doris。
- OpenClaw 写操作仍生成任务台审批请求。
- 停止 Doris 或同步任务后，任务台、微信和现有 MCP 写操作不受影响。

参考：

- [Apache Doris MCP Server](https://github.com/apache/doris-mcp-server)
- [Apache Doris MySQL CDC with SQL Mapping](https://doris.apache.org/docs/dev/data-operate/import/import-way/streaming-job/continuous-load-mysql-table/)

