# FrameQ Server 部署方案

## 1. 部署目标

FrameQ server 负责账号邮箱 OTP 登录、桌面端 session、管理员激活码、管理员后台、LLM 配置下发与话题点额度扣减。桌面端的视频、音频、文字稿和历史记录仍留在用户本机，server 不接收这些文件。

推荐首版生产拓扑：

```text
Internet
  -> Nginx :443
          -> FrameQ server 127.0.0.1:8787
          -> SQLite server/data/frameq.sqlite
          -> SMTP service
```

首版按单机单实例部署。原因是 server 使用 SQLite，并且架构文档明确当前是单 writer service instance。不要同时启动多个 server 进程指向同一个 SQLite 文件。

## 2. 服务器要求

- Ubuntu 22.04/24.04 LTS 或同类 Linux。
- Node.js 22 LTS。
- Nginx 1.22+。
- 一个解析到服务器的 HTTPS 域名：`frameq.8xf.pro`。
- 可用 SMTP 账号，用于桌面端和管理员邮箱验证码。

建议目录：

```text
/opt/frameq/FrameQ          # git checkout
/opt/frameq/FrameQ/server   # server app root
/opt/frameq/FrameQ/server/data
/opt/frameq/FrameQ/server/backups
/var/log/nginx/frameq.*.log
```

## 3. 部署用户和代码

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin frameq
sudo mkdir -p /opt/frameq
sudo chown frameq:frameq /opt/frameq

sudo -u frameq git clone <your-frameq-repo-url> /opt/frameq/FrameQ
cd /opt/frameq/FrameQ/server
sudo -u frameq npm ci
```

当前 `server/package.json` 的 `build` 脚本是 `tsc --noEmit`，没有生成 `dist/`。因此首版 service 使用 `node_modules/.bin/tsx src/index.ts` 启动。后续如需只安装 production dependencies，应先给 server 增加 emit build 和 `start` 脚本。

验证代码和 Prisma client：

```bash
cd /opt/frameq/FrameQ/server
sudo -u frameq npm run build
sudo -u frameq npm run prisma:generate
```

初始化或同步数据库 schema：

```bash
cd /opt/frameq/FrameQ/server
sudo -u frameq npm run db:push
```

## 4. 生产环境变量

在 `/opt/frameq/FrameQ/server/.env` 创建生产配置。不要提交该文件。

```dotenv
NODE_ENV=production
FRAMEQ_SERVER_HOST=127.0.0.1
FRAMEQ_SERVER_PORT=8787
DATABASE_URL=file:./data/frameq.sqlite

FRAMEQ_ADMIN_EMAIL=admin@example.com
FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY=<32+ random bytes encoded as hex/base64>

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=frameq@example.com
SMTP_PASS=<smtp-password>
SMTP_FROM=FrameQ <frameq@example.com>
```

生成加密 key 示例：

```bash
openssl rand -hex 32
```

注意：

- `NODE_ENV=production` 会让管理员 cookie 带 `Secure`，因此必须经 HTTPS 访问。
- `FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY` 丢失后，数据库里已保存的 LLM API key 无法解密。上线后必须备份。

## 5. systemd

复制 service 示例：

```bash
sudo cp /opt/frameq/FrameQ/deploy/systemd/frameq-server.service /etc/systemd/system/frameq-server.service
sudo systemctl daemon-reload
sudo systemctl enable --now frameq-server
sudo systemctl status frameq-server
```

查看日志：

```bash
journalctl -u frameq-server -f
```

## 6. Nginx 反向代理

先复制反向代理 header snippet：

```bash
sudo cp /opt/frameq/FrameQ/deploy/nginx/frameq-proxy-headers.conf /etc/nginx/snippets/frameq-proxy-headers.conf
```

首次接入新域名、证书尚未签发时，先确认 DNS 已经添加 `frameq.8xf.pro A <server-ip>` 并生效，然后让 Certbot 通过 Nginx 插件签发和安装证书：

```bash
sudo certbot --nginx -d frameq.8xf.pro
```

证书签发完成后，可将 `/etc/nginx/sites-available/frameq-server.conf` 替换为 `deploy/nginx/frameq-server.conf` 中的完整 HTTPS 配置，再执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Nginx 只暴露 80/443。FrameQ server 只监听 `127.0.0.1:8787`，不要把 8787 端口开放到公网。

## 7. 上线检查

```bash
curl -I https://frameq.8xf.pro/login
curl -I https://frameq.8xf.pro/admin/login
```

手动验证：

- `/login` 可以打开用户邮箱登录页。
- `/admin/login` 可以打开管理员登录页。
- 非管理员邮箱请求管理员验证码时返回受限提示。
- 管理员登录后可以生成激活码。
- 桌面端可以完成邮箱登录并兑换激活码。
- 如果配置了 LLM，桌面端生成话题点时会扣减一次额度。

## 8. 备份与恢复

SQLite 文件默认位于：

```text
/opt/frameq/FrameQ/server/data/frameq.sqlite
```

建议每天备份 `server/data/` 和 `server/.env`，并把备份复制到服务器外部存储。SQLite 使用 WAL 时还可能出现 `frameq.sqlite-wal` 和 `frameq.sqlite-shm`，备份时应使用 SQLite 在线备份或短暂停服务。

简单停机备份：

```bash
sudo systemctl stop frameq-server
sudo -u frameq mkdir -p /opt/frameq/FrameQ/server/backups
sudo -u frameq tar -czf /opt/frameq/FrameQ/server/backups/frameq-server-$(date +%F-%H%M%S).tgz \
  -C /opt/frameq/FrameQ/server .env data
sudo systemctl start frameq-server
```

## 9. 安全边界

- 不把 `.env`、SQLite、备份、日志、证书私钥提交到 git。
- 管理员入口 `/admin` 仍由应用层邮箱 OTP 和 CSRF 保护；建议额外在 Nginx 或云防火墙限制管理员来源 IP。
- 请求体限制保持较小，因为 server 不接收视频、音频、文字稿上传。
- Nginx 需要保留原始 `Host`、`X-Forwarded-Proto` 和 `X-Forwarded-For`。
- 当前 Fastify 未启用 `trustProxy`，`request.ip` 在 Nginx 后可能显示为 `127.0.0.1`。如果未来要把 IP 级限流作为安全门禁，应先在 server 中显式启用并测试可信代理配置。

## 10. 发布流程

```bash
cd /opt/frameq/FrameQ
sudo -u frameq git pull --ff-only
cd server
sudo -u frameq npm ci
sudo -u frameq npm run build
sudo -u frameq npm run prisma:generate
sudo -u frameq npm run db:push
sudo systemctl restart frameq-server
sudo systemctl status frameq-server
```

回滚时恢复上一版代码和数据库备份。涉及 Prisma schema 变更时，先在测试服务器演练恢复流程。
