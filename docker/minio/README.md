# MinIO (dev object storage)

S3-compatible object storage for local development. Student photos (and any
future binary assets) are stored here in a **private** bucket and served to
clients only through **short-lived presigned URLs** the API generates — the API
never streams object bytes itself.

In production nothing here runs: point the same `S3_*` env vars at AWS S3 and the
server's `StorageService` works unchanged.

## Start

```bash
docker compose -f docker/minio/docker-compose.yml up -d
```

This boots MinIO and a one-shot `createbuckets` job that creates the `nucleus`
bucket (idempotent).

- **S3 API:** http://localhost:9000
- **Web console:** http://localhost:9001 — log in with `minioadmin` / `minioadmin`

## Stop / reset

```bash
docker compose -f docker/minio/docker-compose.yml down        # stop, keep data
docker compose -f docker/minio/docker-compose.yml down -v     # stop + wipe data
```

## Config

The server reads these from `.env` (see `sample.env` for defaults):

| Var | Dev value | Notes |
| --- | --- | --- |
| `S3_ENDPOINT` | `http://localhost:9000` | Omit for real AWS S3 |
| `S3_REGION` | `us-east-1` | |
| `S3_ACCESS_KEY` | `minioadmin` | MinIO root user |
| `S3_SECRET_KEY` | `minioadmin` | MinIO root password |
| `S3_BUCKET` | `nucleus` | |
| `S3_FORCE_PATH_STYLE` | `true` | Required for MinIO; harmless on S3 |

Override the MinIO root credentials by exporting `MINIO_ROOT_USER` /
`MINIO_ROOT_PASSWORD` before `up` (keep them in sync with `S3_ACCESS_KEY` /
`S3_SECRET_KEY`).
