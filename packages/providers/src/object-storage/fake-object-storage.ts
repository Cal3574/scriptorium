import type {
  ObjectStorage,
  PresignedPutRequest,
  StoredObjectHead,
} from './object-storage.js';

// The path the fake's presigned PUT URLs point at. The api process mounts a
// matching dev-only route (below its `api/v1` global prefix) that reads the
// uploaded bytes and calls `putObject`, so the browser upload flow works
// end-to-end in `PROVIDER_MODE=fake` with no real bucket.
export const FAKE_UPLOAD_ROUTE = '/api/v1/_dev/uploads/';

interface FakePutUrl {
  key: string;
  contentType: string;
  expiresInSeconds: number;
}

interface FakeStoredObject {
  body: Buffer;
  contentType: string;
}

export interface FakeObjectStorageOptions {
  // The api's public origin, used as the base of the presigned PUT URL. When
  // omitted the URL is still well-formed (against a placeholder host) but only
  // a caller that writes through `putObject` directly - e.g. an integration
  // test - can land the object.
  publicBaseUrl?: string;
}

/**
 * In-memory {@link ObjectStorage}. `createPresignedPutUrl` returns a URL that
 * points back at the api's dev upload route (see {@link FAKE_UPLOAD_ROUTE});
 * the object is not stored until bytes are PUT there (or a caller uses
 * {@link putObject} / {@link simulateUpload} directly). `headObject` and
 * `getObject` read the in-memory map, so `upload_not_found` and
 * `file_size_mismatch` are both reachable offline.
 */
export class FakeObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, FakeStoredObject>();
  private readonly baseUrl: string;
  // Every presign request, in order - handy for assertions.
  readonly presigned: FakePutUrl[] = [];

  constructor(options: FakeObjectStorageOptions = {}) {
    this.baseUrl = (options.publicBaseUrl ?? 'https://fake-s3.local').replace(
      /\/+$/,
      '',
    );
  }

  createPresignedPutUrl(request: PresignedPutRequest): Promise<string> {
    this.presigned.push({ ...request });
    const url = new URL(`${this.baseUrl}${FAKE_UPLOAD_ROUTE}${request.key}`);
    url.searchParams.set('contentType', request.contentType);
    url.searchParams.set('expires', String(request.expiresInSeconds));
    return Promise.resolve(url.toString());
  }

  headObject(key: string): Promise<StoredObjectHead | null> {
    const object = this.objects.get(key);
    return Promise.resolve(
      object === undefined ? null : { contentLength: object.body.length },
    );
  }

  putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType });
    return Promise.resolve();
  }

  getObject(key: string): Promise<Uint8Array | null> {
    const object = this.objects.get(key);
    return Promise.resolve(object === undefined ? null : object.body);
  }

  deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  /** Simulate a completed client PUT of `sizeBytes` arbitrary bytes to `key`. */
  simulateUpload(key: string, sizeBytes: number): void {
    this.objects.set(key, {
      body: Buffer.alloc(sizeBytes, 7),
      contentType: 'application/pdf',
    });
  }

  /** Simulate a deleted / never-uploaded object. */
  removeObject(key: string): void {
    this.objects.delete(key);
  }

  clear(): void {
    this.objects.clear();
    this.presigned.length = 0;
  }
}
