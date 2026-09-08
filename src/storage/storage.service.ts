import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { DEFAULT_STORAGE_BUCKET } from './storage.constants';

// Cached-URL window: sign for 13h but serve the cached URL for only 12h, so a
// client never receives a link with less than an hour of life left.
const CACHED_URL_SIGN_TTL_SECONDS = 13 * 60 * 60;
const CACHED_URL_CACHE_TTL_SECONDS = 12 * 60 * 60;

/**
 * Thin wrapper over the AWS S3 SDK. The same code drives MinIO in dev and AWS
 * S3 in production — only the `S3_*` env vars change:
 *
 *  - dev  : S3_ENDPOINT=http://localhost:9000, S3_FORCE_PATH_STYLE=true (MinIO)
 *  - prod : omit S3_ENDPOINT (use the real AWS endpoint for the region)
 *
 * Objects live in a private bucket; callers never get a public URL. Reads are
 * served by handing the client a short-lived presigned GET URL so the bytes go
 * straight from S3/MinIO to the client and never transit this API.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    this.bucket = this.config.get<string>('S3_BUCKET', DEFAULT_STORAGE_BUCKET);

    // Two credential modes. Both keys set → static credentials (MinIO in dev, or
    // an IAM user). Both empty → omit `credentials` entirely so the SDK's default
    // provider chain picks up the EC2 instance profile / task role from instance
    // metadata, which is preferred on AWS: no long-lived key on the box to leak
    // or rotate. `validateEnv` rejects a half-set pair at boot, so by the time we
    // get here the two are either both present or both absent.
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY')?.trim();
    const secretAccessKey = this.config.get<string>('S3_SECRET_KEY')?.trim();
    const staticCredentials =
      accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : undefined;

    this.client = new S3Client({
      region: this.config.get<string>('S3_REGION', 'us-east-1'),
      // Present for MinIO; absent for real AWS (SDK derives the endpoint).
      endpoint: endpoint || undefined,
      // MinIO needs path-style addressing; harmless on AWS.
      forcePathStyle:
        this.config.get<string>('S3_FORCE_PATH_STYLE', 'true') === 'true',
      ...staticCredentials,
    });

    this.logger.log(
      staticCredentials
        ? 'S3 auth: static credentials from S3_ACCESS_KEY/S3_SECRET_KEY'
        : 'S3 auth: SDK default provider chain (instance IAM role)',
    );
  }

  /** Upload (or overwrite) an object. */
  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /**
   * A presigned GET URL valid for `ttlSeconds`. The signature embedded in the
   * URL is the time-limited access key — anyone holding the URL can read the
   * object until it expires, after which it 404s. Keep the TTL short.
   */
  getSignedReadUrl(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
  }

  /**
   * A presigned GET URL that is STABLE for ~12 hours: the signed URL is
   * memoized in Redis per object key, so every caller (and every list refresh)
   * hands clients the exact same URL all day. Same URL means browser and
   * native image caches actually hit — each device downloads a photo once per
   * window instead of once per presign. Safe because object keys are
   * immutable: an upload always writes a fresh random key, so a cached URL can
   * never serve stale bytes. Use this for anything rendered repeatedly (list
   * avatars); keep `getSignedReadUrl` for one-shot, tightly-scoped reads.
   * Redis being down just means we fall back to signing per call.
   */
  async getCachedReadUrl(key: string): Promise<string> {
    const cacheKey = `storage:url:${key}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return cached;
    } catch {
      // Cache read failed — sign fresh below; caching is an optimisation.
    }

    const url = await this.getSignedReadUrl(key, CACHED_URL_SIGN_TTL_SECONDS);
    try {
      await this.redis.set(cacheKey, url, 'EX', CACHED_URL_CACHE_TTL_SECONDS);
    } catch {
      // Losing the cache write only costs future cache hits.
    }
    return url;
  }

  /** Delete an object. Missing objects are treated as already-deleted. */
  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (err) {
      // A delete that fails because the object is already gone is fine; log
      // anything else but don't surface it — deletes are best-effort cleanup.
      this.logger.warn(
        `Failed to delete object ${key}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  }

  /** HEAD probe — metadata only, never streams the body. */
  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }
}
