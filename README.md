# me

个人助理任务台：用于记录任务、日志、笔记、附件和 AI 检索。

## 本地运行

1. 安装依赖：

```bash
npm install
```

2. 创建本地环境文件：

```bash
cp .env.example .env
```

3. 在 `.env` 中填写自己的 MySQL、AI、密码门禁等配置。

4. 初始化数据库并启动：

```bash
npm run init-db
npm run dev
```

## 生产更新

服务器上的真实配置保留在 `/srv/assistant-task-board/.env`，不要提交到 GitHub。

以后从 GitHub 更新服务器代码：

```bash
APP_DIR=/srv/assistant-task-board BRANCH=main bash scripts/deploy/update-from-github.sh
```

脚本会执行：

- `git pull`
- `npm ci`
- `npm run build`
- `pm2 restart assistant-task-board --update-env`

## 敏感信息

不要提交以下内容：

- `.env`、`.env.*`
- 数据库密码
- AI API Key
- 登录密码或密码哈希
- 上传文件、备份文件、部署临时包
- 服务器 SSH 密码、证书私钥

`.env.example` 只保留占位符，用来说明需要哪些配置项。
