import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import {
  type BookDto,
  type BookListItemDto,
  CreateBookRequest,
  CreateUploadUrlRequest,
  type CreateUploadUrlResponse,
} from '@scriptorium/contracts';
import {
  assertOwnership,
  type AuthenticatedUser,
  CurrentUser,
  getRequestId,
  OBJECT_STORAGE,
  type ObjectStorage,
  QUEUE,
  type Queue,
  BooksRepository,
} from '@scriptorium/server-core';
import { createZodDto } from 'nestjs-zod';
import { MAX_UPLOAD_BYTES } from './books.tokens';
import { toBookDto, toBookListItemDto } from './book.mapper';
import {
  FileSizeMismatchException,
  FileTooLargeException,
  NotAPdfException,
  S3KeyMismatchException,
  UploadNotFoundException,
} from './books.problems';

const PDF_CONTENT_TYPE = 'application/pdf';
const UPLOAD_URL_TTL_SECONDS = 300;

class CreateUploadUrlDto extends createZodDto(CreateUploadUrlRequest) {}
class CreateBookDto extends createZodDto(CreateBookRequest) {}

@Controller('books')
export class BooksController {
  constructor(
    private readonly books: BooksRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(QUEUE) private readonly queue: Queue,
    @Inject(MAX_UPLOAD_BYTES) private readonly maxUploadBytes: number,
  ) {}

  // Step 1: hand the browser a short-lived presigned PUT pinned to a key we
  // choose, so the bytes never pass through the API.
  @Post('upload-url')
  async createUploadUrl(
    @Body() body: CreateUploadUrlDto,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<CreateUploadUrlResponse> {
    if (body.contentType !== PDF_CONTENT_TYPE) {
      throw new NotAPdfException();
    }
    if (body.fileSizeBytes > this.maxUploadBytes) {
      throw new FileTooLargeException(this.maxUploadBytes);
    }

    const s3Key = `books/${caller.id}/${randomUUID()}.pdf`;
    const uploadUrl = await this.storage.createPresignedPutUrl({
      key: s3Key,
      contentType: PDF_CONTENT_TYPE,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });

    return {
      uploadUrl,
      s3Key,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    };
  }

  // Step 2: the client has completed the PUT. Verify the object really landed
  // under this caller's prefix at the claimed size, then land a `pending` row
  // and enqueue the ingest job (`jobId = bookId`, deduped by the queue).
  @Post()
  async create(
    @Body() body: CreateBookDto,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<BookDto> {
    if (!body.s3Key.startsWith(`books/${caller.id}/`)) {
      throw new S3KeyMismatchException();
    }

    const head = await this.storage.headObject(body.s3Key);
    if (!head) {
      throw new UploadNotFoundException();
    }
    if (head.contentLength !== body.fileSizeBytes) {
      throw new FileSizeMismatchException();
    }

    const { book } = await this.books.create({
      userId: caller.id,
      title: body.title ?? null,
      originalFilename: body.originalFilename,
      s3Key: body.s3Key,
      fileSizeBytes: body.fileSizeBytes,
    });

    // Idempotent both ways: a replay returns the first call's row, and the
    // queue de-dupes on `jobId = bookId`, so re-enqueuing is a no-op.
    await this.queue.enqueueIngest({
      bookId: book.id,
      requestId: getRequestId(),
    });

    return toBookDto(book);
  }

  @Get()
  async list(
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<BookListItemDto[]> {
    const rows = await this.books.listByUser(caller.id);
    return rows.map(toBookListItemDto);
  }

  // Hard delete. Flips the book to `deleting` and enqueues the `delete` job on
  // the ingest queue, which stops any running ingest, drops both S3 objects,
  // and removes the row (Postgres cascades chapters/chunks and nulls
  // `queries.book_id`). Returns `202` with an empty body; an unknown or
  // unowned id is an identical `404`. Fully idempotent: `markDeleting` is a
  // no-op transition and the queue de-dupes on `jobId = delete:<bookId>`, so a
  // repeat call (or a retry after a partial failure) is a safe `202` that
  // re-drives the delete rather than a dead end.
  @Delete(':id')
  @HttpCode(202)
  async remove(
    @Param('id') id: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<void> {
    const found = await this.books.findById(id);
    assertOwnership(found, caller.id, 'book_not_found');

    await this.books.markDeleting(id);
    await this.queue.enqueueDelete({
      bookId: id,
      requestId: getRequestId(),
    });
  }
}
