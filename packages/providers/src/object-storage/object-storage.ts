// The seam between the app and blob storage. Two flows use it:
//
//  - Upload: the browser never streams bytes through the API. `POST
//    /books/upload-url` asks this seam for a short-lived presigned PUT pinned
//    to a server-chosen key and content type, the client PUTs straight to the
//    bucket, then `POST /books` asks this seam to `head` the object to confirm
//    the upload landed and its size matches.
//  - Ingest: the worker's `extract` stage reads the original PDF back with
//    `getObject`, then writes the full extracted markdown as a permanent
//    object with `putObject` (the `extracted_markdown_key`), which later
//    stages slice chapter prose from.
//
// The live adapter drives AWS S3 (or any S3-compatible endpoint); the fake
// keeps an in-memory map of keys to bytes so the whole handoff runs offline in
// tests.

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
  // Write an object directly (server-side). Used by the ingest pipeline to
  // store derived artifacts such as the extracted markdown blob.
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  // Read an object's bytes. Resolves `null` when the key does not exist.
  getObject(key: string): Promise<Uint8Array | null>;
  // Delete an object. Idempotent: deleting a key that is not there resolves
  // without error. Used by the book hard-delete flow to drop the original PDF
  // and the extracted markdown blob.
  deleteObject(key: string): Promise<void>;
}

// Nest DI token; bound by `server-core` from `PROVIDER_MODE`.
export const OBJECT_STORAGE = Symbol('ObjectStorage');
