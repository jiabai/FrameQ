# FrameQ Server Production Runbook

## 1. Supported topology

FrameQ server handles account OTP login, administrator access, activation entitlements, encrypted
LLM configuration, and atomic AI-credit checkout. It never receives desktop video, audio,
transcript, or generated-content files.

The supported first production topology is one process and one local SQLite database:

```text
Internet -> Nginx :443 -> FrameQ server 127.0.0.1:8787
                                -> local SQLite file
                                -> SMTP provider
```

Run exactly one FrameQ server instance for each SQLite file. Do not place the database on NFS,
SMB, a synchronized folder, or shared storage. Changing the proxy or database topology requires a
new architecture review and trusted-proxy tests.

## 2. Host and secrets

Use Ubuntu 22.04/24.04 or an equivalent supported Linux host, Node.js 22, Nginx, HTTPS, and a
working SMTP account. Install under `/opt/frameq/FrameQ` as the unprivileged `frameq` user.

Create `/opt/frameq/FrameQ/server/.env` with mode `0600`. Production startup fails closed unless
the database URL, administrator email, encryption key, and complete SMTP configuration are
present. `FRAMEQ_ALLOW_CONSOLE_OTP=1` and `WECHAT_DEV_INSECURE_NOTIFY=1` are forbidden in
production.

```dotenv
NODE_ENV=production
FRAMEQ_SERVER_HOST=127.0.0.1
FRAMEQ_SERVER_PORT=8787
DATABASE_URL=file:/opt/frameq/FrameQ/server/data/frameq.sqlite
FRAMEQ_ADMIN_EMAIL=admin@example.com
FRAMEQ_LLM_CONFIG_ENCRYPTION_KEY=<at-least-32-random-characters>
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=frameq@example.com
SMTP_PASS=<smtp-password>
SMTP_FROM=FrameQ <frameq@example.com>
WECHAT_PAY_ENABLED=0
```

Generate the encryption key with `openssl rand -hex 32`. Back up the exact key separately from the
database; encrypted LLM credentials cannot be recovered without it. Never put `.env`, database,
backup, log, certificate private-key, or restore artifacts in Git.

## 3. Install and validate code

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin frameq
sudo mkdir -p /opt/frameq
sudo chown frameq:frameq /opt/frameq
sudo -u frameq git clone <reviewed-repository-url> /opt/frameq/FrameQ
cd /opt/frameq/FrameQ/server
sudo -u frameq npm ci
sudo -u frameq npm run prisma:generate
sudo -u frameq npm test
sudo -u frameq npm run build
```

The reference service runs `tsx src/index.ts`; therefore the current deployment installs the
locked development toolchain as well as runtime dependencies.

## 4. Database migration paths

Production schema changes use reviewed Prisma migrations only. The deployment script invokes
`prisma migrate deploy`; never use schema push against a production database.

For a fresh database, create an empty local file with restrictive permissions, deploy all reviewed
migrations, then run database preflight and migration status:

```bash
sudo systemctl stop frameq-server
test ! -e /opt/frameq/FrameQ/server/data/frameq.sqlite
sudo -u frameq install -m 600 /dev/null /opt/frameq/FrameQ/server/data/frameq.sqlite
cd /opt/frameq/FrameQ/server
sudo -u frameq npm run db:migrate:deploy
sudo -u frameq npm run db:migrate:status
sudo -u frameq npm run db:preflight -- --mode current
```

For an existing database created before migration history was introduced:

1. stop the service;
2. make and verify the backup described below;
3. run `npm run db:preflight -- --mode baseline`;
4. only after the baseline check passes, run
   `npx prisma migrate resolve --applied 202607220001_baseline`;
5. run `npm run db:migrate:deploy`, `npm run db:migrate:status`, and
   `npm run db:preflight -- --mode current`.

The baseline check rejects negative or overused quota state. Do not clamp, delete, or hand-edit
accounting rows to force a migration through. The forward migration deliberately invalidates
outstanding legacy OTPs because their purpose cannot be inferred safely.

## 5. Stop-the-service backup

Always stop the service before copying SQLite. This avoids an incomplete main/WAL/SHM set and also
proves that no second application instance owns the file.

```bash
sudo systemctl stop frameq-server
sudo -u frameq npm --prefix /opt/frameq/FrameQ/server run db:preflight -- --mode current
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
sudo -u frameq install -d -m 700 /opt/frameq/FrameQ/server/backups/$STAMP
sudo -u frameq cp --preserve=mode,timestamps \
  /opt/frameq/FrameQ/server/data/frameq.sqlite \
  /opt/frameq/FrameQ/server/backups/$STAMP/frameq.sqlite
sudo -u frameq cp --preserve=mode,timestamps \
  /opt/frameq/FrameQ/server/.env \
  /opt/frameq/FrameQ/server/backups/$STAMP/server.env
cd /opt/frameq/FrameQ/server/backups/$STAMP
sudo -u frameq sha256sum frameq.sqlite server.env > SHA256SUMS
sudo -u frameq chmod -R go-rwx /opt/frameq/FrameQ/server/backups/$STAMP
```

Verify the SHA-256 manifest immediately. Keep a documented retention window and copy the encrypted
backup plus checksum to protected off-host storage. Secret backup access must be narrower than
application source access. Evidence records only UTC time, backup identifier, and pass/fail—not
paths, emails, tokens, keys, database rows, or checksums tied to private locations.

## 6. Isolated restore rehearsal

Rehearse restore before every schema-changing release and periodically thereafter. Never rehearse
over the live database.

```bash
RESTORE_ROOT=/var/tmp/frameq-restore-$STAMP
sudo -u frameq install -d -m 700 "$RESTORE_ROOT"
cd /protected/off-host-copy
sudo -u frameq sha256sum --check SHA256SUMS
sudo -u frameq cp /protected/off-host-copy/frameq.sqlite "$RESTORE_ROOT/frameq.sqlite"
cd /opt/frameq/FrameQ/server
sudo -u frameq npm run db:restore-smoke -- --database "$RESTORE_ROOT/frameq.sqlite"
sudo -u frameq env DATABASE_URL="file:$RESTORE_ROOT/frameq.sqlite" npm run db:migrate:status
```

The restore smoke opens the database read-only, runs `PRAGMA integrity_check`, validates foreign
keys and required migrations, checks quota invariants, and performs bounded account/entitlement
reads without printing rows. For a full rehearsal, start the reviewed code against the isolated
copy on an alternate loopback port, verify `/health/live` and `/health/ready`, then stop it and
delete the rehearsal directory securely.

## 7. Deploy and post-deploy smoke

```bash
sudo systemctl stop frameq-server
# Complete Sections 5 and 6 before continuing.
cd /opt/frameq/FrameQ
sudo -u frameq git fetch --tags --prune
sudo -u frameq git checkout <reviewed-commit-or-tag>
cd server
sudo -u frameq npm ci
sudo -u frameq npm run prisma:generate
sudo -u frameq npm test
sudo -u frameq npm run build
sudo -u frameq npm run db:migrate:deploy
sudo -u frameq npm run db:migrate:status
sudo -u frameq npm run db:preflight -- --mode current
sudo systemctl start frameq-server
curl --fail --silent https://frameq.8xf.pro/health/live
curl --fail --silent https://frameq.8xf.pro/health/ready
```

Then verify one non-user test-inbox OTP login, administrator login, ticket exchange, an idempotent
quota checkout with a fake/provider-approved test path, log redaction, and `systemctl restart`.
Do not record the mailbox, OTP, session, request body, prompt, LLM key, or raw database error.

Nginx exposes only the exact health paths. Fastify trusts forwarded addresses only when its direct
peer is loopback. Port 8787 must remain firewalled from the Internet.

## 8. Rollback

Rollback restores a matched code, database, and configuration set:

1. stop the service;
2. preserve the failed deployment for offline diagnosis without logging its contents;
3. restore the prior reviewed code/tag, complete SQLite backup, and matching `.env`/encryption key;
4. verify SHA-256, run the isolated restore smoke, and confirm migration status with that code;
5. replace the live set only after rehearsal succeeds, start the service, and repeat health/login/
   quota/log-redaction smoke checks.

Do not write an ad-hoc reverse migration and do not reverse-edit live entitlement, usage-event,
OTP, ticket, or session tables. If restore evidence is unavailable or fails, keep the service
stopped and escalate rather than guessing.

## 9. systemd and Nginx

Install the reviewed files from `deploy/systemd/` and `deploy/nginx/`, validate with
`systemd-analyze verify` and `nginx -t`, then reload their managers. The application shutdown
deadline is 15 seconds; systemd `TimeoutStopSec=20` and `KillSignal=SIGTERM` leave the process time
to mark readiness false, drain Fastify, and disconnect Prisma.
