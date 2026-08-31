import {
  BookDto,
  BookListItemDto,
  DELETE_JOB_NAME,
  INGEST_QUEUE_NAME,
  IngestEvent,
  PipelineStage,
  QueryEvent,
  UpdateBookRequest,
} from './index.js';

describe('@scriptorium/contracts', () => {
  const baseBook = {
    id: '11111111-1111-4111-8111-111111111111',
    title: null,
    author: null,
    originalFilename: 'atomic-habits.pdf',
    fileSizeBytes: 8123456,
    pageCount: null,
    status: 'pending' as const,
    failedStage: null,
    failureReason: null,
    summaryGeneratedAt: null,
    createdAt: '2026-08-31T10:00:00.000Z',
    updatedAt: '2026-08-31T10:00:00.000Z',
  };

  it('accepts a well-formed BookDto', () => {
    expect(BookDto.parse(baseBook)).toEqual(baseBook);
  });

  it('rejects an unknown book status', () => {
    expect(() => BookDto.parse({ ...baseBook, status: 'archived' })).toThrow();
  });

  it('BookListItemDto drops updatedAt', () => {
    expect('updatedAt' in BookListItemDto.shape).toBe(false);
    expect('updatedAt' in BookListItemDto.parse(baseBook)).toBe(false);
  });

  it('UpdateBookRequest requires at least one field', () => {
    expect(() => UpdateBookRequest.parse({})).toThrow();
    expect(UpdateBookRequest.parse({ author: null })).toEqual({ author: null });
  });

  it('discriminates IngestEvent by type', () => {
    const parsed = IngestEvent.parse({
      type: 'stage_progress',
      bookId: baseBook.id,
      seq: 7,
      stage: 'embedding',
      done: 448,
      total: 800,
      unit: 'chunks',
    });
    expect(parsed.type).toBe('stage_progress');
  });

  it('discriminates QueryEvent by type', () => {
    const parsed = QueryEvent.parse({ type: 'text_delta', text: 'hello' });
    expect(parsed.type).toBe('text_delta');
  });

  it('exposes the queue and job-name constants', () => {
    expect(INGEST_QUEUE_NAME).toBe('ingest');
    expect(DELETE_JOB_NAME).toBe('delete');
    expect(PipelineStage.options).toContain('chapterSummary');
  });
});
