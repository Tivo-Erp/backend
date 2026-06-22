import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import {
  MAX_UPLOAD_SIZE_BYTES,
  isStructurallyValidKey,
} from './storage-key.util.js';

export interface PresignResult {
  key: string;
  url: string;
  expiresInSec: number;
}

/** Browser-POST presign (policy-constrained upload). */
export interface PresignPostResult {
  key: string;
  url: string;
  /** Form fields the client must include in the multipart POST. */
  fields: Record<string, string>;
  expiresInSec: number;
}

/**
 * INF-003 — S3/MinIO object storage (ADR-012). Issues pre-signed PUT/GET URLs
 * so large blobs (POD photos, shipping labels, attachments, employee docs)
 * never transit the API. Keys are namespaced `{tenantId}/{module}/{entityId}/{file}`
 * and every operation is tenant-prefix-checked by the caller.
 *
 * Optional-safe: with no `S3_ENDPOINT` the client is not constructed and any
 * file operation raises `FILE_STORAGE_NOT_CONFIGURED` (503) rather than crashing
 * boot — matching the batch-6 "safe when env absent" principle.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client: MinioClient | null = null;
  private readonly bucket: string;
  private readonly presignTtl: number;
  private readonly endpoint: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = config.get<string>('app.s3Bucket', 'erp-files');
    this.presignTtl = config.get<number>('app.s3PresignTtlSec', 300);
    this.endpoint = config.get<string>('app.s3Endpoint', '');
    if (this.endpoint) {
      this.client = new MinioClient({
        endPoint: this.endpoint,
        port: config.get<number>('app.s3Port', 443),
        useSSL: config.get<boolean>('app.s3UseSsl', true),
        accessKey: config.get<string>('app.s3AccessKey', ''),
        secretKey: config.get<string>('app.s3SecretKey', ''),
      });
    }
  }

  get configured(): boolean {
    return !!this.client;
  }

  async onModuleInit() {
    if (!this.client) {
      this.logger.warn('S3_ENDPOINT not set — file storage disabled.');
      return;
    }
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket, '');
        this.logger.log(`Created bucket "${this.bucket}".`);
      }
    } catch (err) {
      this.logger.error(`Bucket init failed: ${(err as Error).message}`);
    }
  }

  private require(): MinioClient {
    if (!this.client) {
      throw new BusinessException(
        'FILE_STORAGE_NOT_CONFIGURED',
        'File storage is not configured on this server',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.client;
  }

  /** Build the tenant-scoped object key. `filename` is sanitised to a basename. */
  buildKey(
    tenantId: string,
    module: string,
    entityId: string,
    filename: string,
  ): string {
    const safe =
      filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'file';
    const safeModule = module.replace(/[^a-zA-Z0-9_-]/g, '');
    const safeEntity = entityId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeModule || !safeEntity) {
      throw new BusinessException(
        'FILE_KEY_INVALID',
        'Invalid module or entityId for file key',
        HttpStatus.BAD_REQUEST,
      );
    }
    const key = `${tenantId}/${safeModule}/${safeEntity}/${Date.now()}-${safe}`;
    this.assertStructurallyValidKey(key);
    return key;
  }

  /**
   * Policy-constrained pre-signed POST for a key the caller already
   * built/validated. The signed policy pins the exact key, the declared
   * content type and a 1..maxSizeBytes content-length range, so the client
   * cannot upload a different file type or an oversized blob.
   */
  async presignUpload(
    key: string,
    contentType: string,
    maxSizeBytes: number,
  ): Promise<PresignPostResult> {
    const client = this.require();
    const policy = client.newPostPolicy();
    policy.setBucket(this.bucket);
    policy.setKey(key);
    policy.setExpires(new Date(Date.now() + this.presignTtl * 1000));
    policy.setContentType(contentType);
    policy.setContentLengthRange(
      1,
      Math.min(Math.max(maxSizeBytes, 1), MAX_UPLOAD_SIZE_BYTES),
    );
    const { postURL, formData } = await client.presignedPostPolicy(policy);
    await this.scanHook(key);
    return {
      key,
      url: postURL,
      fields: formData,
      expiresInSec: this.presignTtl,
    };
  }

  /**
   * Virus-scan hook placeholder (compliance). No-op today.
   * TODO(SEC): wire to an AV pipeline (e.g. ClamAV via bucket-notification
   * worker) and quarantine objects until scanned before serving downloads.
   */
  scanHook(key: string): Promise<void> {
    this.logger.debug(`scanHook (placeholder, no-op) for key=${key}`);
    return Promise.resolve();
  }

  /**
   * Server-side upload of bytes the API itself produced (e.g. a carrier
   * shipping label fetched from the provider). Unlike the presigned-POST flow
   * this is used when the content originates on the server, not the browser.
   * No-op-safe via {@link require} (raises 503 when storage is unconfigured).
   */
  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<{ key: string }> {
    this.assertStructurallyValidKey(key);
    const client = this.require();
    await client.putObject(this.bucket, key, body, body.length, {
      'Content-Type': contentType,
    });
    await this.scanHook(key);
    return { key };
  }

  /** Pre-signed download URL (short TTL). */
  async presignDownload(key: string): Promise<PresignResult> {
    const url = await this.require().presignedGetObject(
      this.bucket,
      key,
      this.presignTtl,
    );
    return { key, url, expiresInSec: this.presignTtl };
  }

  /** Reject structurally unsafe keys ('', '.', '..' segments, '%', '\\', leading '/'). */
  assertStructurallyValidKey(key: string): void {
    if (!isStructurallyValidKey(key)) {
      throw new BusinessException(
        'FILE_KEY_INVALID',
        'File key is structurally invalid',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /** Reject any key that does not live under the caller's tenant prefix. */
  assertTenantOwnsKey(tenantId: string, key: string): void {
    this.assertStructurallyValidKey(key);
    if (!key.startsWith(`${tenantId}/`)) {
      throw new BusinessException(
        'FILE_KEY_FORBIDDEN',
        'File key does not belong to your organization',
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
