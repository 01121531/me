# LlamaIndex 与 OpenClaw 集成落地方案

## 目标

把当前个人助理任务台升级成可部署到服务器的智能工作系统：

- MySQL 仍然是任务、日志、笔记、附件、审批和审计的唯一事实来源。
- LlamaIndex 负责把任务、日志、笔记和可解析附件转换为可检索文档。
- Qdrant 只保存向量和检索 metadata，不直接承载业务数据。
- LiteLLM 作为唯一云模型网关，统一接入聊天模型和 embedding 模型。
- OpenClaw 通过私有 MCP Server 读写任务台，不直接访问 MySQL、Qdrant、MinIO/S3 或服务器文件系统。
- 所有 OpenClaw 写入先生成待审批动作，用户在网页中批准后才真正写入业务表。

## 已完成状态

1. 阶段 1：对象存储、OIDC、审计与 SSE
   - 已完成本地/S3 存储抽象，附件可切换到 MinIO/S3。
   - 已完成 OIDC 登录框架，本地默认关闭，部署时可启用。
   - 已完成 `audit_events` 和 `/api/events` SSE，页面可自动刷新。

2. 阶段 2：LiteLLM、Qdrant、索引队列与 Worker
   - 已完成 `ai_index_jobs`、`ai_index_state`。
   - 已完成 `npm run ai:worker` 独立索引 Worker。
   - 已完成任务、日志、笔记、附件写入后的异步索引入队。

3. 阶段 3：LlamaIndex 检索与网页 AI
   - 已完成 LlamaIndex + Qdrant + LiteLLM 检索链路。
   - 已完成顶部“智能检索”和任务详情“智能”页签。
   - 已完成 PDF、Word、Excel、CSV 文本解析；不执行宏、脚本或嵌入对象。

4. 阶段 4：OpenClaw MCP 读工具
   - 已完成私有 Streamable HTTP MCP Server：`/mcp`。
   - 已完成 Bearer Token 鉴权，默认关闭。
   - 已完成读工具：
     - `search_workspace`
     - `list_tasks`
     - `get_task`
     - `get_task_timeline`
     - `search_notes`
     - `generate_report`
     - `list_attachments`

5. 阶段 5：OpenClaw 写操作、审批与提醒
   - 已完成 `mcp_action_requests` 待审批表。
   - 已完成 MCP 写入请求工具：
     - `request_create_task`
     - `request_update_task`
     - `request_create_log`
     - `request_update_log`
     - `request_create_note`
     - `request_update_note`
   - 已完成网页顶部“审批”入口、角标提醒、批准/拒绝弹窗。
   - 已完成批准后写入任务、日志、笔记，并通过 SSE 自动刷新页面。

## 生产架构

```text
浏览器 / 手机 / OpenClaw
        |
      HTTPS
        |
  反向代理（TLS、限流、安全头）
        |
  assistant-task-board API + 前端静态资源 + MCP Server
        |
        |-- MySQL：任务、日志、笔记、附件元信息、审批、审计、索引队列
        |-- MinIO/S3：任务/日志/笔记附件文件
        |-- Qdrant：LlamaIndex 向量索引
        |-- LiteLLM：云模型与 embedding 网关
        `-- ai-worker：异步解析附件、构建文档、写入向量库
```

生产环境中只有 HTTPS 入口暴露到公网。MySQL、Qdrant、MinIO/S3、LiteLLM 管理端和 Node 服务内部端口都应限制在私有网络。

## 环境变量清单

核心服务：

```env
PORT=3000
DB_HOST=mysql
DB_PORT=3306
DB_USER=assistant_task_board
DB_PASSWORD=replace-me
DB_DATABASE=assistant_task_board
```

对象存储：

```env
STORAGE_DRIVER=s3
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=assistant-task-board
S3_ACCESS_KEY_ID=replace-me
S3_SECRET_ACCESS_KEY=replace-me
S3_FORCE_PATH_STYLE=true
```

登录与访问控制：

```env
AUTH_MODE=oidc
SESSION_SECRET=replace-with-a-long-random-value
AUTH_SECURE_COOKIES=true
CORS_ALLOWED_ORIGINS=https://tasks.example.com
OIDC_ISSUER=https://issuer.example.com
OIDC_CLIENT_ID=assistant-task-board
OIDC_CLIENT_SECRET=replace-me
OIDC_REDIRECT_URI=https://tasks.example.com/auth/callback
OIDC_SCOPE=openid profile email
OIDC_ALLOWED_SUBJECTS=
```

AI 与索引：

```env
AI_INDEXING_ENABLED=true
AI_INDEX_VERSION=2
AI_WORKER_POLL_MS=1500
AI_WORKER_MAX_ATTEMPTS=5
AI_ATTACHMENT_PARSE_MAX_BYTES=12582912
AI_ATTACHMENT_TEXT_MAX_CHARS=80000
LITELLM_BASE_URL=http://litellm:4000/v1
LITELLM_API_KEY=replace-me
LITELLM_EMBEDDING_MODEL=embeddings-primary
LITELLM_CHAT_MODEL=chat-primary
QDRANT_URL=http://qdrant:6333
QDRANT_API_KEY=
QDRANT_COLLECTION=assistant_task_board
```

如果模型网关暂时不提供 OpenAI 兼容 `/v1/embeddings` 接口，可以先保持
`AI_INDEXING_ENABLED=false`，只配置 `LITELLM_CHAT_MODEL`。网页智能检索/问答会自动从
Qdrant 语义检索降级到 MySQL 关键词与最近资料检索，再交给聊天模型生成带来源的回答。

OpenClaw MCP：

```env
MCP_ENABLED=true
MCP_TOKEN=replace-with-a-long-random-token
```

## 启动顺序

1. 启动 MySQL，并确认数据库账号权限最小化。
2. 启动 MinIO/S3，并创建或授权 `assistant-task-board` bucket。
3. 启动 Qdrant，确保只允许内网访问。
4. 启动 LiteLLM，配置云模型供应商、模型路由和成本记录。
5. 启动任务台 API：

```bash
npm run start
```

6. 启动 AI Worker：

```bash
npm run ai:worker
```

7. 通过反向代理暴露 HTTPS。
8. 在 OpenClaw 中注册 MCP endpoint：`https://tasks.example.com/mcp`，鉴权使用 `Authorization: Bearer <MCP_TOKEN>`。

## OpenClaw 使用边界

OpenClaw 可以读取：

- 任务列表、任务详情、任务时间线。
- 独立笔记与任务笔记。
- 日报/周报汇总。
- 附件元信息和下载路径。
- LlamaIndex 语义检索结果。

OpenClaw 可以提出待审批写入：

- 创建/更新任务。
- 创建/更新日志。
- 创建/更新笔记。

OpenClaw 暂不开放：

- 删除任务、日志、笔记或附件。
- 批量重排任务/笔记。
- 直接上传附件。
- 直接修改数据库、对象存储或向量库。

这些能力后续可以继续加，但建议仍走待审批动作。

## 安全要求

- `MCP_ENABLED=true` 时必须设置强随机 `MCP_TOKEN`。
- MCP Token 只给 OpenClaw 服务端，不放入浏览器或前端环境变量。
- 生产环境必须启用 OIDC 和 HTTPS。
- `AUTH_SECURE_COOKIES=true` 只应在 HTTPS 下启用。
- 数据库账号不要使用 root。
- Qdrant、MinIO、MySQL 不暴露公网。
- 附件解析只读取文件文本，不执行宏、脚本、压缩包内容或嵌入对象。
- 定期备份 MySQL、MinIO/S3 bucket 和 Qdrant collection。

## 验收命令

```bash
node --check server/index.js
node --check server/action-requests.js
node --check server/mcp/server.js
npm run smoke
npm run smoke:index-queue
npm run smoke:attachments
npm run smoke:llamaindex
npm run smoke:mcp
npm run smoke:mcp-actions
npm run build
```

当前已通过以上核验。`npm run build` 会提示前端单包超过 500 kB，这是既有包体积提醒，不影响功能。

## 后续增强

- 给 MCP 写工具增加附件上传能力，仍走审批。
- 增加 OCR 和更多附件类型解析。
- 增加全量/单任务重建索引 API。
- 给 `mcp_action_requests` 增加幂等键，防止 OpenClaw 网络重试导致重复请求。
- 增加 OpenClaw 主动提醒：到期任务、长时间无日志任务、索引失败、待审批积压。
- 将前端 AI/富文本编辑器做代码拆分，降低首包体积。
