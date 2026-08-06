#!/usr/bin/env bash
#
# Deploy the FrameQ marketing site (Astro static build) to production.
#
# What it does:
#   1. Build the site  -> site/dist
#   2. Rsync dist/ to the server web root (default /home/ubuntu/FrameQ/site)
#   3. Print the nginx reload command (run on the server)
#
# The marketing site shares the domain frameq.8xf.pro with the FrameQ
# server app. nginx (deploy/nginx/frameq-server.conf) serves "/" statically
# from /home/ubuntu/FrameQ/site and proxies /api/*, /auth/, /admin, /user/, /login,
# /dashboard to the backend (127.0.0.1:8787).
#
# NOTE: site/ is git-ignored, so the source lives only on this machine.
# Build happens locally and only dist/ is transferred.
#
# Usage:
#   DEPLOY_SERVER=user@host ./scripts/deploy-marketing.sh
#   DEPLOY_SERVER=user@host REMOTE_WEBROOT=/srv/www/frameq ./scripts/deploy-marketing.sh
#
set -euo pipefail

DEPLOY_SERVER="${DEPLOY_SERVER:?set DEPLOY_SERVER=user@your-server}"
REMOTE_WEBROOT="${REMOTE_WEBROOT:-/home/ubuntu/FrameQ/site}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Building marketing site (site/dist)"
( cd "$REPO_ROOT/site" && npm ci && npm run build )

echo "==> Syncing dist/ -> ${DEPLOY_SERVER}:${REMOTE_WEBROOT}/"
rsync -avz --delete --exclude='.git' \
  "$REPO_ROOT/site/dist/" \
  "${DEPLOY_SERVER}:${REMOTE_WEBROOT}/"

echo "==> Done. On the server, apply/reload nginx config:"
echo "    sudo nginx -t && sudo systemctl reload nginx"
