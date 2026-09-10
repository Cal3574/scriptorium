import { buildTimeline, type TimelineInput } from './ingest-timeline';

const base: TimelineInput = {
  status: 'pending',
  stage: null,
  progress: null,
};

function ids(input: Partial<TimelineInput>) {
  return buildTimeline({ ...base, ...input }).rows.map(
    (r) => `${r.id}:${r.state}`,
  );
}

describe('buildTimeline', () => {
  it('is all-pending and queued before the worker starts', () => {
    const t = buildTimeline(base);
    expect(t.phase).toBe('queued');
    expect(t.rows.every((r) => r.state === 'pending')).toBe(true);
    expect(t.rows.map((r) => r.id)).toEqual([
      'read',
      'passages',
      'embed',
      'chapters',
      'book-summary',
    ]);
  });

  it('marks the extract stage active, the rest pending', () => {
    expect(ids({ status: 'extracting', stage: 'extracting' })).toEqual([
      'read:active',
      'passages:pending',
      'embed:pending',
      'chapters:pending',
      'book-summary:pending',
    ]);
  });

  it('adds the identified sub-line once a title is known', () => {
    const t = buildTimeline({
      ...base,
      status: 'chunking',
      stage: 'chunking',
      title: 'Deep Work',
      author: 'Cal Newport',
    });
    expect(t.rows[0]).toMatchObject({ state: 'done' });
    expect(t.rows[0].subline).toBe('Identified: Deep Work - Cal Newport');
  });

  it('drops the author dash when the author is unknown', () => {
    const t = buildTimeline({
      ...base,
      status: 'chunking',
      stage: 'chunking',
      title: 'Meditations',
      author: null,
    });
    expect(t.rows[0].subline).toBe('Identified: Meditations');
  });

  it('shows live chunk counts while embedding', () => {
    const t = buildTimeline({
      ...base,
      status: 'embedding',
      stage: 'embedding',
      progress: { done: 120, total: 400, unit: 'chunks' },
    });
    expect(t.rows.map((r) => r.state)).toEqual([
      'done',
      'done',
      'active',
      'pending',
      'pending',
    ]);
    expect(t.rows[2].detail).toEqual({ done: 120, total: 400, unit: 'chunks' });
  });

  it('retains the passage total as a stat once embedding is done', () => {
    const t = buildTimeline({
      ...base,
      status: 'summarizing',
      stage: 'summarizing',
      chaptersTotal: 12,
      chaptersSummarized: 3,
      passagesTotalMark: 1240,
    });
    expect(t.rows[2]).toMatchObject({ state: 'done', stat: '1,240 passages' });
    expect(t.rows[3]).toMatchObject({ state: 'active' });
    expect(t.rows[3].detail).toEqual({ done: 3, total: 12, unit: 'chapters' });
    expect(t.rows[4].state).toBe('pending');
  });

  it('advances to the book summary once every chapter is summarised', () => {
    const t = buildTimeline({
      ...base,
      status: 'summarizing',
      stage: 'summarizing',
      chaptersTotal: 12,
      chaptersSummarized: 12,
    });
    expect(t.rows[3]).toMatchObject({ state: 'done', stat: '12 chapters' });
    expect(t.rows[4].state).toBe('active');
  });

  it('falls back to the progress frame for chapter counts when the snapshot fields are absent', () => {
    const t = buildTimeline({
      ...base,
      status: 'summarizing',
      stage: 'summarizing',
      progress: { done: 2, total: 5, unit: 'chapters' },
    });
    expect(t.rows[3]).toMatchObject({ state: 'active' });
    expect(t.rows[3].detail).toEqual({ done: 2, total: 5, unit: 'chapters' });
  });

  it('is all-done and done-phase when the book is ready', () => {
    const t = buildTimeline({ ...base, status: 'ready' });
    expect(t.phase).toBe('done');
    expect(t.rows.every((r) => r.state === 'done')).toBe(true);
  });

  it('freezes at the failed stage: earlier done, later pending', () => {
    const t = buildTimeline({
      ...base,
      status: 'failed',
      stage: null,
      failedStage: 'embed',
    });
    expect(t.phase).toBe('failed');
    expect(t.rows.map((r) => r.state)).toEqual([
      'done',
      'done',
      'failed',
      'pending',
      'pending',
    ]);
  });

  it('maps a stranded-job failure (failedStage is a raw book_status) to its row', () => {
    const t = buildTimeline({
      ...base,
      status: 'failed',
      stage: null,
      failedStage: 'embedding',
    });
    expect(t.rows.map((r) => r.state)).toEqual([
      'done',
      'done',
      'failed',
      'pending',
      'pending',
    ]);
  });

  it('maps chapterSummary and bookSummary failures to their rows', () => {
    expect(
      buildTimeline({
        ...base,
        status: 'failed',
        failedStage: 'chapterSummary',
      }).rows[3].state,
    ).toBe('failed');
    expect(
      buildTimeline({ ...base, status: 'failed', failedStage: 'bookSummary' })
        .rows[4].state,
    ).toBe('failed');
  });
});
