import {
  BookDto,
  BookListItemDto,
  DELETE_JOB_NAME,
  INGEST_QUEUE_NAME,
  IngestEvent,
  PipelineStage,
  QueryEvent,
  UpdateBookFields,
  UpdateBookRequest,
  UsageDto,
  ActivityDto,
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

  it('UpdateBookFields accepts an empty object but not a null title', () => {
    expect(UpdateBookFields.parse({})).toEqual({});
    expect(() => UpdateBookFields.parse({ title: null })).toThrow();
    expect(() => UpdateBookFields.parse({ title: 'x'.repeat(501) })).toThrow();
    expect(UpdateBookFields.parse({ author: null })).toEqual({ author: null });
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

  it('accepts a well-formed UsageDto and rejects an unknown plan', () => {
    const usage = {
      plan: 'free' as const,
      books: { used: 1, limit: 2 },
      queries: { used: 14, limit: 20, resetsAt: '2026-10-01T00:00:00.000Z' },
    };
    expect(UsageDto.parse(usage)).toEqual(usage);
    expect(() => UsageDto.parse({ ...usage, plan: 'enterprise' })).toThrow();
  });

  it('UsageDto rejects a zero or negative limit and a non-integer count', () => {
    const base = {
      plan: 'pro' as const,
      books: { used: 0, limit: 50 },
      queries: { used: 0, limit: 1000, resetsAt: '2026-10-01T00:00:00.000Z' },
    };
    expect(() =>
      UsageDto.parse({ ...base, books: { used: 0, limit: 0 } }),
    ).toThrow();
    expect(() =>
      UsageDto.parse({ ...base, books: { used: 1.5, limit: 50 } }),
    ).toThrow();
  });

  const baseActivity = {
    totals: { books: 3, questions: 42, pagesIngested: 1200 },
    plan: {
      plan: 'free' as const,
      questionsUsed: 14,
      questionsLimit: 20,
      resetsAt: '2026-10-01T00:00:00.000Z',
    },
    monthly: Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, '0')}`,
      books: 0,
      questions: 0,
    })),
    topBooks: [
      {
        bookId: '22222222-2222-4222-8222-222222222222',
        title: 'Deep Work',
        questionCount: 9,
      },
    ],
  };

  it('accepts a well-formed ActivityDto', () => {
    expect(ActivityDto.parse(baseActivity)).toEqual(baseActivity);
  });

  it('ActivityDto requires exactly 12 monthly entries', () => {
    expect(() =>
      ActivityDto.parse({
        ...baseActivity,
        monthly: baseActivity.monthly.slice(0, 11),
      }),
    ).toThrow();
  });

  it('ActivityDto caps topBooks at 5 and rejects a zero questionCount', () => {
    expect(() =>
      ActivityDto.parse({
        ...baseActivity,
        topBooks: Array.from({ length: 6 }, () => baseActivity.topBooks[0]),
      }),
    ).toThrow();
    expect(() =>
      ActivityDto.parse({
        ...baseActivity,
        topBooks: [{ ...baseActivity.topBooks[0], questionCount: 0 }],
      }),
    ).toThrow();
  });

  it('ActivityDto rejects a malformed month key', () => {
    expect(() =>
      ActivityDto.parse({
        ...baseActivity,
        monthly: [
          { month: '2026-9', books: 0, questions: 0 },
          ...baseActivity.monthly.slice(1),
        ],
      }),
    ).toThrow();
  });

  it('exposes the queue and job-name constants', () => {
    expect(INGEST_QUEUE_NAME).toBe('ingest');
    expect(DELETE_JOB_NAME).toBe('delete');
    expect(PipelineStage.options).toContain('chapterSummary');
  });
});
