import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  ObjectStorage,
  PresignedPutRequest,
  StoredObjectHead,
} from './object-storage.js';

export interface S3ObjectStorageOptions {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  // Set for an S3-compatible endpoint (MinIO, LocalStack); omit for real AWS.
  endpoint?: string;
}

/**
 * Live {@link ObjectStorage} over AWS S3. `createPresignedPutUrl` signs a
 * `PUT` that is only valid for the exact key and `Content-Type` passed - the
 * browser cannot upload to a different key or lie about the type.
 */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly options: S3ObjectStorageOptions) {
    this.client = new S3Client({
      region: options.region,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      // Recent SDK versions default flexible checksums to `WHEN_SUPPORTED`,
      // which signs `x-amz-sdk-checksum-algorithm` / `x-amz-checksum-*` into
      // the presigned PUT. The browser only sends `Content-Type`, so those
      // signed-but-absent headers break the upload (SignatureDoesNotMatch, or
      // a CORS preflight rejection). Only add a checksum header when the
      // operation actually requires one.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      ...(options.endpoint
        ? { endpoint: options.endpoint, forcePathStyle: true }
        : {}),
    });
  }

  createPresignedPutUrl(request: PresignedPutRequest): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: request.key,
      ContentType: request.contentType,
    });
    return getSignedUrl(this.client, command, {
      expiresIn: request.expiresInSeconds,
    });
  }

  async headObject(key: string): Promise<StoredObjectHead | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      return { contentLength: head.ContentLength ?? 0 };
    } catch (error) {
      if (error instanceof NotFound) return null;
      throw error;
    }
  }

  async putObject(
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getObject(key: string): Promise<Uint8Array | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      if (!result.Body) return null;
      return await result.Body.transformToByteArray();
    } catch (error) {
      if (error instanceof NoSuchKey || error instanceof NotFound) return null;
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    // S3 `DeleteObject` is already idempotent - deleting an absent key is a
    // success - so there is nothing to swallow here.
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }),
    );
  }
}
