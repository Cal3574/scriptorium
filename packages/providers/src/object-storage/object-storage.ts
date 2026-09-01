// The seam between the app and blob storage for the original PDF uploads. The
// browser never streams bytes through the API: `POST /books/upload-url` asks
// this seam for a short-lived presigned PUT pinned to a server-chosen key and
// content type, the client PUTs straight to the bucket, then `POST /books`
// asks this seam to `head` the object to confirm the upload landed and its
// size matches.
//
// The live adapter drives AWS S3 (or any S3-compatible endpoint); the fake
// keeps an in-memory map of keys to sizes so the whole upload handoff runs
// offline in tests.

export interface PresignedPutRequest {
  // The object key the PUT must target. The presigned URL is pinned to it -
  // the client cannot redirect the upload elsewhere.
  key: string;
  // The `Content-Type` the PUT must send. Pinned into the signature.
  contentType: string;
  // How long the URL stays valid.
  expiresInSeconds: number;
}

export interface StoredObjectHead {
  // The object's size in bytes, from the S3 `HEAD` `ContentLength`.
  contentLength: number;
}

export interface ObjectStorage {
  // Mint a presigned `PUT` URL pinned to `key` and `contentType`.
  createPresignedPutUrl(request: PresignedPutRequest): Promise<string>;
  // `HEAD` the object. Resolves `null` when the key does not exist.
  headObject(key: string): Promise<StoredObjectHead | null>;
}

// Nest DI token; bound by `server-core` from `PROVIDER_MODE`.
export const OBJECT_STORAGE = Symbol('ObjectStorage');
