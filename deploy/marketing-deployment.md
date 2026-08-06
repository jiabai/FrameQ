# FrameQ 营销站（静态站点）部署文档

> 配套文档：`deploy/server-deployment.md`（后端运行手册）。
> 本文件只讲 **Astro 静态营销站** 的上线，不涉及后端 Server 的数据库、OTP、迁移等流程。

---

## 1. 概述

营销站是一个纯静态站点（Astro SSG），构建后产出自包含的 `site/dist/`。
它与 FrameQ 后端 **共用同一个域名 `https://frameq.8xf.pro/`**，由 nginx 在同一 `443 server` 块内分工：

| 路径 | 处理方式 |
|---|---|
| `/`、`/download`、`/privacy`、`/_astro/`、`/video/`、`/og/`、`/robots.txt`、`/sitemap*` | nginx 直接静态托管 `dist/` |
| `/api/dashboard/*`、`/api/desktop/*`、`/api/wechat/notify`、`/auth/`、`/user/`、`/login`、`/dashboard`、`/admin`、`/admin/*`、`/health/live`、`/health/ready` | 反代到后端 `127.0.0.1:8787`（仅这几个子路径，其它 `/api/*` 落到 `location /` 返回 404） |

**关键前提**：`site/` 已被整体 `gitignore`。仓库里**没有**营销站源码，部署方式是
**本机构建 → 只把 `dist/` 内容传到服务器**，服务器上不需要 git 仓库、不需要 Node 运行时。
线上 webroot 为 `/home/ubuntu/FrameQ/site`（Ubuntu），里面放的就是 `dist/` 的内容。

---

## 2. 拓扑

```text
Internet ──▶ Nginx :443 (frameq.8xf.pro)
                  ├── /           ──▶ 静态文件  /home/ubuntu/FrameQ/site   (营销站 dist 内容)
                  ├── /_astro/    ──▶ 静态资源（哈希、immutable）
                  ├── /video/     ──▶ 演示视频 / 海报
                  └── /api/* 等   ──▶ 反代  127.0.0.1:8787              (FrameQ 后端)
```

---

## 3. 前提条件

**本机（构建端，即你现在用的机器）**
- Node.js 22 / npm
- 能读取 `site/` 源码（它只在你本机）
- `scp`（跨平台，Windows 自带 OpenSSH 客户端即可）；若偏好 `rsync`，Linux/macOS 自带，Windows 可用 WSL 或 Git Bash
- 能通过 SSH 登录目标服务器

**服务器（Ubuntu）**
- 已安装并运行 nginx（后端部署时通常已就绪）
- 已存在 `deploy/nginx/frameq-server.conf` 所依赖的共享片段：
  `/etc/nginx/snippets/frameq-proxy-headers.conf`（由后端部署引入，静态托管不依赖它）
- 已配置好证书 `/etc/letsencrypt/live/frameq.8xf.pro/`（后端部署时已签发）
- webroot 目录 `/home/ubuntu/FrameQ/site`（与 nginx `root` 对齐；该目录存放 `dist/` 构建产物，不是仓库源码）

> 如果服务器**尚未**部署过后端，`frameq-server.conf` 中的反代块和证书路径都还不存在，
> 需要先完成 `server-deployment.md` 的步骤，或把 conf 里反代相关 `location` 块按实际后端情况补齐。

---

## 4. 本机构建

```bash
cd D:/Github/FrameQ/site
npm ci
npm run build
```

产物在 `site/dist/`，结构示例：

```text
dist/
├── index.html          # 首页（含演示视频区块）
├── download/index.html
├── privacy/index.html
├── _astro/             # 打包后的 CSS/JS/字体（哈希命名）
├── video/              # frameq-demo.mp4 + frameq-demo-poster.jpg
├── og/                 # 社交分享图
├── favicon.svg
├── robots.txt
├── sitemap-index.xml
├── sitemap-0.xml
└── site.zip            # 构建残留，约 6 MB，部署时应排除（见第 6/9 节）
```

仅该目录需要上线。

---

## 5. 服务器 nginx 配置

配置文件（单一文件，含后端反代 + 静态托管两部分）位于本仓库：

```text
deploy/nginx/frameq-server.conf
```

它已包含：
- `root /home/ubuntu/FrameQ/site; index index.html;`
- `location /_astro/ { expires 1y; immutable; }`（Astro 哈希资源）
- `location /video/ { expires 30d; }`（演示视频/海报）
- `location / { try_files $uri $uri/ $uri.html =404; }`（首页/下载/隐私/sitemap 等）
- 全部后端反代 `location` 块（原样保留）

**重要规则：同域名只有一个 `443 server` 块，不要新建第二个。**
若服务器上后端已在运行，该 conf 多半已启用但**没有**静态托管部分——此时应
**用本仓库最新版覆盖原文件**，再 reload，避免重复 `server_name` 冲突。

落地步骤（在服务器上执行）：

```bash
# 假设后端已启用 /etc/nginx/sites-enabled/frameq（指向同一文件）
# 先把最新 conf 传到服务器，再校验
sudo cp deploy/nginx/frameq-server.conf /etc/nginx/sites-available/frameq
sudo nginx -t
sudo systemctl reload nginx
```

若使用 `conf.d` 而非 `sites-available/enabled`，把文件放到
`/etc/nginx/conf.d/frameq.conf` 并删除可能重复的同域名块即可。

---

## 6. 部署（只传 dist 内容）

线上 webroot 为 `/home/ubuntu/FrameQ/site`（Ubuntu），里面放 `dist/` 的内容。
**不要**把整个 `site/` 源码目录传上去——它比 `dist/` 大约 12 倍（含 `node_modules`/`src`），
且运行时完全用不上。实测：`dist/` ≈ 12.5 MB（含 `site.zip` 残留约 6 MB），`site/` ≈ 159 MB。

> 构建后建议先清掉 `site/dist/site.zip`（Astro 偶发残留，约 6 MB，线上用不到）：
> `rm -f D:/Github/FrameQ/site/dist/site.zip`

### 方式 A：手动 scp（当前实际使用）

本机构建后，把 `dist/` 内容传到服务器 webroot。首次部署或服务器上目录为空时直接传：

```bash
# 1) 本机构建
cd D:/Github/FrameQ/site && npm ci && npm run build
rm -f dist/site.zip   # 清掉残留

# 2) 传到服务器（Windows 下用 scp，PowerShell/Git Bash 均可）
scp -r dist/* user@你的服务器:/home/ubuntu/FrameQ/site/
```

增量更新时，为避免旧文件残留（如已改名的 `_astro/` 哈希文件），建议先清空 webroot 再传：

```bash
# 服务器上清空 webroot（谨慎：确认路径正确）
ssh user@你的服务器 'rm -rf /home/ubuntu/FrameQ/site/*'

# 本机传新内容
scp -r D:/Github/FrameQ/site/dist/* user@你的服务器:/home/ubuntu/FrameQ/site/
```

> 注：`scp -r` 不带 `--delete`，不会自动清旧文件。若不清空，旧的 `_astro/` 哈希资源
> 会累积（不影响功能，但占空间）。`/video/`、`/og/` 等不变文件重复传也无害。

### 方式 B：rsync 脚本（可选自动化）

仓库提供 `scripts/deploy-marketing.sh`，自动完成"构建 + rsync 同步"，并用 `--delete`
清掉服务器多余文件，适合习惯 rsync 的场景：

```bash
cd D:/Github/FrameQ
DEPLOY_SERVER=user@你的服务器 ./scripts/deploy-marketing.sh
```

可选环境变量：
- `DEPLOY_SERVER`（必填）：SSH 目标，如 `ubuntu@203.0.113.4`
- `REMOTE_WEBROOT`（默认 `/home/ubuntu/FrameQ/site`）：与 nginx `root` 对齐

脚本会：① 本机构建 `site/dist` → ② `rsync -avz --delete --exclude='.git'` 传到 `REMOTE_WEBROOT/`。
`--delete` 会清掉服务器上多余文件，保证与本地构建一致。

> 注：脚本目前**未排除** `dist/site.zip`（约 6 MB），它会被一并上传到 webroot。
> 如不想传它，在脚本里加 `--exclude='site.zip'`，或在构建后 `rm site/dist/site.zip`。
> Windows 下需通过 WSL 或 Git Bash 运行（依赖 `rsync`）。

---

## 7. 验证

部署并 reload nginx 后，在本地或服务器执行：

```bash
# 首页
curl -sI https://frameq.8xf.pro/ | head -n 1
# 期望：HTTP/2 200

# 演示视频（Range 支持、可拖拽）
curl -sI https://frameq.8xf.pro/video/frameq-demo.mp4 | grep -iE "HTTP|content-type|content-length|accept-ranges"
# 期望：video/mp4，有 Content-Length，Accept-Ranges: bytes

# 打包资源
curl -sI https://frameq.8xf.pro/_astro/ | head -n 1

# 后端不受影响（仍反代）
curl --fail --silent https://frameq.8xf.pro/health/live
```

浏览器打开 `https://frameq.8xf.pro/`，确认首页文案、下载/隐私页、视频可点击播放。

---

## 8. 回滚

每次部署前先备份线上 `dist/`，便于快速回退：

```bash
# 在服务器上，部署前执行
sudo cp -a /home/ubuntu/FrameQ/site /home/ubuntu/FrameQ/site.bak.$(date -u +%Y%m%dT%H%M%SZ)
```

回滚：

```bash
sudo rsync -a --delete /home/ubuntu/FrameQ/site.bak.<时间戳>/ /home/ubuntu/FrameQ/site/
# 静态站点无需重启 nginx；若同时改过 nginx 配置，用旧 conf 覆盖后 nginx -t && reload
```

> 注意：回滚只恢复**静态站点**。若 nginx 配置也改动过（如新增静态块），
> 需同时把 `frameq-server.conf` 回退到上一版，再 `nginx -t && systemctl reload nginx`。

---

## 9. 注意事项

- **源码不在仓库**：`site/` 已 gitignore，仅存于本机。换机器构建需先把 `site/` 带过去。
- **nginx 与后端同源**：修改 `frameq-server.conf` 会影响后端反代，改前先 `nginx -t`。
- **证书续期**：conf 保留了 `/.well-known/acme-challenge/`，certbot 续期不受影响。
- **缓存头**：`/_astro/`（1 年 immutable）、`/video/`（30 天）带缓存；发布新版本后
  哈希文件名会变，旧资源自然失效，无需手动清缓存。
- **自定义 404**：当前未知路径返回 nginx 默认 404。若想要品牌 404 页，在
  `site/src/pages/404.astro` 建页重建，再把 `location /` 的 `=404` 改为 `/404.html`。
- **视频源文件**：演示视频源在 `site/public/video/frameq-demo.mp4`（约 5.3 MB），
  构建时原样拷到 `dist/video/`。仓库里没有所谓 75 MB 重编码源——如需重新压片只能重新提供原片。
- **压缩**：当前未开启 gzip/brotli。如需进一步减小传输体积，可在 nginx 对应
  `location` 或 `http` 块加 `gzip on;` / `brotli on;`（不影响功能）。

---

## 10. 完整发布流程（速查）

```bash
# 1) 本机：构建
cd D:/Github/FrameQ/site && npm ci && npm run build
rm -f dist/site.zip   # 清掉残留

# 2) 服务器：备份当前站点（可选但建议）
ssh user@服务器 'sudo cp -a /home/ubuntu/FrameQ/site /home/ubuntu/FrameQ/site.bak.$(date -u +%Y%m%dT%H%M%SZ)'

# 3) 本机：传 dist 内容到 webroot（首次部署或 nginx 有变动时，额外执行第 4 步覆盖 conf）
scp -r D:/Github/FrameQ/site/dist/* user@服务器:/home/ubuntu/FrameQ/site/

# 4) 服务器：若 nginx 配置有变动，覆盖并校验
sudo cp deploy/nginx/frameq-server.conf /etc/nginx/sites-available/frameq
sudo nginx -t && sudo systemctl reload nginx

# 5) 验证
curl -sI https://frameq.8xf.pro/ | head -n 1
curl --fail --silent https://frameq.8xf.pro/health/live
```
