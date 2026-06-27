# FrameQ Server Deployment

This directory contains deployment notes and reference configs for the FrameQ account,
activation-code, LLM-checkout and entitlement server.

- [server-deployment.md](./server-deployment.md) - production deployment runbook.
- [nginx/frameq-server.conf](./nginx/frameq-server.conf) - Nginx reverse proxy sample.
- [nginx/frameq-proxy-headers.conf](./nginx/frameq-proxy-headers.conf) - reusable proxy headers snippet.
- [systemd/frameq-server.service](./systemd/frameq-server.service) - systemd service sample.

The server should be kept private behind Nginx and listen on `127.0.0.1:8787`.
Do not put real `.env`, SQLite databases, backups, logs, certificates, or private keys in git.
