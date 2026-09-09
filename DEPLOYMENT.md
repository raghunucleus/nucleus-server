# Nucleus Server — Deployment Guide

Production deployment of the Nucleus API with Docker Compose. One VM runs **only
the API**; PostgreSQL, Redis and object storage are all external (managed AWS
services), and the three web front-ends are deployed **separately as static
bundles on S3/CloudFront**.

```
Browser ──HTTPS──► CloudFront/S3 ┬─ nucleusadmin.raghuenggcollege.in  (nucleus-admin-ui)
   │                             │
   │                             ├─ employee.raghuenggcollege.in  ┐
   │                             ├─ parent.raghuenggcollege.in    ├ ONE nucleus-ui bundle
   │                             └─ student.raghuenggcollege.in   ┘
   │
   ├──HTTPS──► nginx (TLS) ──► app :3000   (docker compose)
   │              api-nucleus.raghuenggcollege.in
   │              REST + Socket.IO (student chat, student/employee notifications)
   │                                  │  (private network, TLS — §1)
   │                                  ├── PostgreSQL :5432  (RDS)
   │                                  └── Redis      :6379  (ElastiCache)
   │
   └──HTTPS──► AWS S3 (presigned URLs — photos, certificates, JD files, exports)

Outbound from app: SendGrid (mail), AWS S3, Google (OIDC token verification),
                   Expo (push notifications)
```

The compose stack (`docker-compose.yml` at the repo root) builds one image and
runs it twice — nothing else:

| Service   | Image                   | Role                                              |
| --------- | ----------------------- | ------------------------------------------------- |
| `migrate` | built from `Dockerfile` | One-shot: applies TypeORM migrations, then exits. |
| `app`     | built from `Dockerfile` | The NestJS API on port 3000.                      |

Redis carries the Socket.IO fan-out for student chat and both notification
streams, plus the presigned-URL cache. `RedisIoAdapter.connectToRedis()` is
awaited before the server listens, so an unreachable Redis stalls startup. Its
contents are all re-creatable.

The image is `node:24-bookworm-slim` (multi-stage). Debian is required — the
native modules `bcrypt` and `sharp` ship glibc prebuilds; do not swap in an
`-alpine` base.

---

## 1. Prerequisites

- A Linux VM with Docker Engine 24+ and the Compose v2 plugin (`docker compose version`).
- DNS for `api-nucleus.raghuenggcollege.in` pointing at the VM.
- TLS termination in front of port 3000 — nginx (§7). The app speaks plain HTTP.
- **A PostgreSQL server** (RDS), version 16+ — the schema is developed against
  `postgres:18`. Create the database and an owner role; migrations run as that
  role. Reachable from the app host on 5432.
  - RDS Postgres 16+ enables `rds.force_ssl=1` in the default parameter group,
    so `POSTGRES_SSL=true` is **mandatory** — a plaintext connection is rejected
    outright, and that includes the `migrate` step. Prefer also setting
    `POSTGRES_SSL_CA_FILE` (§5).
- **A Redis server** (ElastiCache), version 7+ — developed against `redis:8.2`.
  If the instance has encryption-in-transit, set `REDIS_TLS=true`; if it has an
  AUTH token, set `REDIS_PASSWORD`. Only one of the two may be omitted, never
  both.
- An AWS account (S3 + IAM), a SendGrid account with a verified sender, and the
  Google Cloud OAuth clients used for sign-in.

## 2. Get the code

```bash
git clone https://github.com/raghunucleus/nucleus-server.git
cd nucleus-server
```

## 3. AWS S3 setup

The app uses **one private bucket**, named by `S3_BUCKET` (`raghu-nucleus` for
this deployment). Features are separated by key prefix, not by bucket:

| Prefix                   | Contents                                    |
| ------------------------ | ------------------------------------------- |
| `student-photos/`        | Profile photos (re-encoded by sharp)        |
| `student-certificates/`  | Student-uploaded certificates               |
| `companies/<id>/logo/`   | Company logos                               |
| `drives/<id>/jd/`        | Job-description attachments                 |
| `exports/<employeeId>/`  | Async export files (CSV/XLSX, 24 h TTL)     |

The bucket **must exist before first boot** — the app never creates it. Every
read is a short-lived presigned GET; the API never proxies object bytes.

> **Note:** S3 bucket names are globally unique across all AWS accounts. The
> deployment account must own `raghu-nucleus`.

### 3.1 Create the bucket

```bash
REGION=ap-south-1        # must match S3_REGION in .env.production
BUCKET=raghu-nucleus     # must match S3_BUCKET

aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"
```

Keep **Block Public Access ON** (the default) — nothing is public.

### 3.2 IAM principal (object access only)

Attach a policy limited to **object** operations on exactly this bucket.
Deliberately **no `s3:CreateBucket`** — production must fail loudly if the
bucket is missing rather than create one with default settings — and **no
`s3:ListBucket`**: the app never lists objects, and a leaked key that could list
would enumerate every student's photo and certificate at once.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::raghu-nucleus/*"]
    }
  ]
}
```

Two ways to provide credentials:

- **Instance IAM role (preferred):** attach the policy to the EC2 instance
  profile and leave `S3_ACCESS_KEY` / `S3_SECRET_KEY` **empty** — the SDK's
  default provider chain picks the role up from instance metadata. No key on the
  box to rotate or leak.
- **Static IAM user:** create a dedicated IAM user with an access key, attach the
  same policy, and set the pair.

Setting exactly one of the two is rejected at boot. The boot log states which
mode is active: `S3 auth: SDK default provider chain (instance IAM role)` or
`S3 auth: static credentials from S3_ACCESS_KEY/S3_SECRET_KEY`.

### 3.3 Bucket CORS

The browser loads presigned URLs directly from S3. Apply a CORS rule allowing
all four portal origins:

```bash
aws s3api put-bucket-cors --bucket raghu-nucleus --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": [
      "https://nucleusadmin.raghuenggcollege.in",
      "https://employee.raghuenggcollege.in",
      "https://parent.raghuenggcollege.in",
      "https://student.raghuenggcollege.in"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }]
}'
```

With `S3_FORCE_PATH_STYLE=false` (required on AWS) the bucket is addressed
virtual-hosted style, so it is its own origin —
`https://raghu-nucleus.s3.ap-south-1.amazonaws.com`. That exact string goes into
each UI's `VITE_STORAGE_ORIGIN` so their CSPs allow it.

## 4. SendGrid

Production **refuses to boot without `SENDGRID_API_KEY`** — and for good reason:
without a key, `MailService` logs every message and drops it. Password resets,
temp passwords and guardian OTPs would all vanish while the app looked healthy.

1. Create an API key with *Mail Send* permission.
2. Verify the sender address (or domain) used as `MAIL_FROM`.

## 5. Configuration (`.env.production`)

```bash
cp production.env.example .env.production
```

Fill it in following the comments in the template. Generate every secret
independently — the validator rejects duplicates:

```bash
openssl rand -base64 48   # each of the 8 JWT_* secrets and SECURITY_PASS_SECRET
```

Boot-time validation (`src/config/env.validation.ts`) refuses to start otherwise,
and reports **every** problem at once rather than one per restart:

- `NODE_ENV` must be exactly `production` (`prod` is a fatal error, not a
  fallback).
- All 9 secrets present, ≥ 32 chars, **mutually distinct**. Four audiences
  (admin / student / guardian / employee) each have their own login, guards and
  token storage; that separation is only real if the signing keys differ.
- `CORS_ORIGINS` set with no `*` entry, `STUDENT_APP_URL` / `EMPLOYEE_APP_URL`
  absolute, `SENDGRID_API_KEY` + `MAIL_FROM` set.
- `POSTGRES_HOST`, `REDIS_HOST` set — unset, the code falls back to `localhost`,
  which inside the app container is nothing at all. (Both port vars may be
  omitted; the code defaults of 5432/6379 are correct for real servers.)
- `REDIS_PASSWORD` set **unless** `REDIS_TLS=true`.
- `S3_BUCKET` set; `S3_FORCE_PATH_STYLE=false` when `S3_ENDPOINT` is empty; the
  S3 key pair both-set or both-empty; no dev MinIO endpoint left behind.
- No dev credential anywhere (`nucleus_dev_pw`, `redis_dev_pw`, `minioadmin`,
  `postgres` are rejected).

Datastore TLS (both default to off, which is what local dev uses):

| Var | Effect |
| --- | --- |
| `POSTGRES_SSL=true` | TLS to the database. **Required for RDS** (`rds.force_ssl` is on by default). |
| `POSTGRES_SSL_CA_FILE` | Path to a CA bundle *inside the container* — verifies the server certificate. Without it the connection is encrypted but unverified and the app warns at boot. Mount it with the commented-out volume in `docker-compose.yml`; for RDS use [the global bundle](https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem). |
| `REDIS_TLS=true` | TLS to Redis. Required for ElastiCache with encryption-in-transit. The Amazon root CA is already in Node's trust store, so no CA file is needed. |

### Sharing the Redis instance with central-server

This app's Redis may be shared with `central-server`. Both write to DB 0, so
every key and pub/sub channel nucleus owns is namespaced under `nucleus:`
(`src/redis/redis-namespace.ts`); central keeps the bare namespaces it was
deployed with. Nothing needs configuring for this — the prefix is a hardcoded
constant, not an env var — but two instance-level settings matter:

- **`maxmemory-policy` must not be `allkeys-*`.** Under central's memory
  pressure an `allkeys-lru` policy would evict *our* live refresh-token
  families and log people out at random. Every nucleus key carries a TTL, so
  `volatile-*` is survivable, but `noeviction` is the correct setting for an
  instance holding auth state — it fails writes loudly instead of silently
  dropping sessions.
- **No `FLUSHDB` / `FLUSHALL` in operational runbooks.** A flush aimed at one
  app takes the other's sessions with it. Neither codebase issues one; keep it
  that way for manual `redis-cli` work too.

Isolation here is a convention enforced in application code, not by the server.
If the two apps ever compete for memory or CPU, split them onto separate
instances (or add a Redis ACL user restricted to `~nucleus:*` / `&nucleus:*`)
rather than relying on the prefix alone.

The portal pairing:

| Server var | Value |
| ---------- | ----- |
| `CORS_ORIGINS` | All four portal **origins** — scheme + host, **no path, no trailing slash**, comma separated |
| `STUDENT_APP_URL` / `EMPLOYEE_APP_URL` | The student and employee portal base URLs — emailed links are built from these |

`.env.production` is gitignored and read only at container start — it is never
baked into the image.

## 6. Build and run

```bash
docker compose build
docker compose up -d
```

Startup order is enforced by the compose file: `migrate` applies all pending
TypeORM migrations against RDS and exits → `app` starts (the server itself never
runs migrations; `migrationsRun` is `false`). If the database is unreachable or
refuses the connection, `migrate` fails and `app` never starts — which is the
point.

```bash
docker compose logs -f migrate app
```

Verify:

```bash
curl -fsS http://127.0.0.1:3000/health/live    # process is serving
curl -fsS http://127.0.0.1:3000/health/ready   # Postgres AND Redis reachable
```

Migration management:

```bash
docker compose run --rm migrate node node_modules/typeorm/cli.js migration:show -d dist/data-source.js
docker compose run --rm migrate   # re-run pending migrations manually (idempotent)
```

Reference data (Indian states/districts, education boards) ships **inside**
migrations, so there is no separate seed step.

## 7. Reverse proxy / TLS (nginx)

The app serves REST **and** three Socket.IO namespaces on the same port. The
proxy **must** forward WebSocket upgrades: all three browser clients connect with
`transports: ['websocket']` — websocket-only, with **no HTTP long-polling
fallback** — so a proxy missing the `Upgrade`/`Connection` headers breaks student
chat and both notification streams outright, with no graceful degradation.

```nginx
server {
    listen 443 ssl http2;
    server_name api-nucleus.raghuenggcollege.in;

    ssl_certificate     /etc/letsencrypt/live/api-nucleus.raghuenggcollege.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api-nucleus.raghuenggcollege.in/privkey.pem;

    # The app parses 10 MB JSON bodies (bulk student/employee upload) and accepts
    # 10 MB file attachments. 25m leaves headroom for multipart overhead.
    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # WebSockets — REQUIRED, see above.
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Real client IP — must match TRUST_PROXY=1 in .env.production
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Long-lived sockets
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
```

`TRUST_PROXY` must mirror the topology: `1` behind exactly this one proxy. Behind
no proxy, leave it unset — otherwise clients can spoof their IP in the logs. The
compose port mapping is already `127.0.0.1:3000:3000`, so plain HTTP is not
reachable from outside the VM.

## 8. Deploying the front-ends

The server does **not** serve any UI. Each repo has its own `DEPLOYMENT.md`:

- `nucleus-admin-ui` → `nucleusadmin.raghuenggcollege.in`
- `nucleus-ui` → **one** build serving `employee.`, `parent.` and `student.`,
  which it distinguishes at runtime from `window.location.hostname`

Both need `VITE_API_URL=https://api-nucleus.raghuenggcollege.in` at **build**
time. After the URLs are final, set `CORS_ORIGINS` / `STUDENT_APP_URL` /
`EMPLOYEE_APP_URL` here (§5) and `docker compose up -d` to reload.

Each portal origin must also be added to the **Google Cloud Console** OAuth
client's authorized JavaScript origins, or Google sign-in fails there.

## 9. Operations

**Run exactly one `app` replica.** `ExportCleanupService.sweep()` flips any
export still `pending`/`processing` after 30 minutes to `failed`, and there is no
worker-ownership column — so a second replica kills the first one's in-flight
exports. Export jobs are detached in-process promises with no durable queue.
Scaling out requires a real queue first.

**Timezone.** No `@Cron` in this codebase names its timezone, so all three
scheduled jobs inherit the container's `TZ` — which is why compose sets
`Asia/Kolkata` explicitly. This is *not* cosmetic; leaving it unset moves the
nightly chat purge to 3 AM UTC.

| Job | Schedule | Effect |
| --- | --- | --- |
| Chat cleanup | daily 03:00 | Deletes messages older than `CHAT_MESSAGE_RETENTION_DAYS` |
| Export cleanup | hourly | Deletes expired export files from S3; fails stale jobs |
| Drive auto-reject | hourly | Expires un-responded drive invitations |

**Logs** — `docker compose logs -f app migrate`. Datastore logs live in the RDS /
ElastiCache CloudWatch log groups.

**Health** — `GET /health/live` (liveness, no dependencies; also the container
healthcheck) and `GET /health/ready` (pings Postgres **and** Redis). Point uptime
monitoring at `/health/ready` through the proxy.

**Backups** — the compose stack is stateless; there are no data volumes. Enable
RDS automated backups + point-in-time recovery, and take a manual snapshot before
a risky migration. Redis holds only re-creatable state. Enable **versioning** on
the S3 bucket for object recovery.

**Upgrades**

```bash
git pull
docker compose build
docker compose up -d     # migrate runs pending migrations, then app restarts
```

The app has graceful shutdown (30 s drain) and websocket clients reconnect
automatically. Roll back code with `git checkout <tag>` + rebuild; roll back a
migration only if you know it is reversible:
`docker compose run --rm migrate node node_modules/typeorm/cli.js migration:revert -d dist/data-source.js`.

## 10. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| App exits immediately, log lists env errors | Production env validation (§5). The message names every failing variable at once — read the whole list. |
| Migrations fail: `no pg_hba.conf entry … no encryption` | RDS requires TLS. Set `POSTGRES_SSL=true` — it applies to `migrate` and `app` alike. |
| Boot warns "server certificate is NOT verified" | `POSTGRES_SSL=true` without `POSTGRES_SSL_CA_FILE`. Mount the RDS global bundle (uncomment the volume in `docker-compose.yml`, **both** services). |
| Redis errors with a TLS/handshake failure | `REDIS_TLS` doesn't match the server: `true` against a plaintext instance, or unset against one with encryption-in-transit. |
| `migration:run` says "No migrations are pending" against an empty DB | The image was built from a context containing a stale `*.tsbuildinfo`, so `npm run build` emitted nothing. `.dockerignore` excludes it; rebuild with `--no-cache`. |
| Browser calls all fail with CORS errors | `CORS_ORIGINS` must list all four portal **origins** exactly — scheme + host, no path, no trailing slash. |
| Chat / notifications never connect, keep retrying | nginx missing the `Upgrade`/`Connection` headers (§7). The clients are websocket-only and cannot fall back to polling. |
| Uploads fail with S3 errors | Bucket missing (production never auto-creates — §3.1), IAM policy not attached, or wrong `S3_REGION`. For AWS keep `S3_ENDPOINT` empty and `S3_FORCE_PATH_STYLE=false`. |
| Photos/attachments don't load in the browser | Bucket CORS not applied for the portal origins (§3.3), the origin missing from that UI's `VITE_STORAGE_ORIGIN` (so its CSP blocks it), or the presigned URL expired. |
| Emails not arriving | Key lacks Mail Send permission, or `MAIL_FROM` isn't a verified sender. Dev captures to the `dev_mail_outbox` table instead of sending. |
| Password-reset links point at localhost | `STUDENT_APP_URL` / `EMPLOYEE_APP_URL` still hold dev values. Note the production `EMPLOYEE_APP_URL` carries **no** `?app=employee` query — that dev marker exists only because dev shares one origin across all three audiences. |
| Exports randomly flip to `failed` | More than one `app` replica is running (§9). |
| `/docs` is 404 | Swagger is off in production by design; set `ENABLE_SWAGGER_IN_PRODUCTION=true` only deliberately. |
| Scheduled jobs fire at the wrong hour | `TZ` on the app container. No `@Cron` names its zone, so they follow it — compose sets `Asia/Kolkata`. |
