import type { IngestEvent } from '@scriptorium/contracts';

import { fold, type IngestProgress } from './ingest-fold';

const snapshot: IngestProgress = {
  status: 'summarizing',
  stage: 'summarizing',
  progress: null,
  chaptersTotal: 15,
  chaptersSummarized: 11,
  title: 'A Book',
  author: 'An Author',
  failedStage: null,
  failureReason: null,
};

const base = { bookId: '00000000-0000-0000-0000-000000000000', seq: 1 };

describe('fold', () => {
  it('advances the chapter tally from a chapters-unit stage_progress frame', () => {
    const next = fold(snapshot, {
      ...base,
      type: 'stage_progress',
      stage: 'summarizing',
      done: 15,
      total: 15,
      unit: 'chapters',
    } as IngestEvent);

    // The row cell (reads `progress`) and the timeline (reads
    // `chaptersSummarized`) must land on the same number.
    expect(next).toMatchObject({
      progress: { done: 15, total: 15, unit: 'chapters' },
      chaptersSummarized: 15,
      chaptersTotal: 15,
    });
  });

  it('leaves the chapter tally untouched for a chunks-unit stage_progress frame', () => {
    const next = fold(snapshot, {
      ...base,
      type: 'stage_progress',
      stage: 'embedding',
      done: 120,
      total: 400,
      unit: 'chunks',
    } as IngestEvent);

    expect(next).toMatchObject({
      progress: { done: 120, total: 400, unit: 'chunks' },
      chaptersSummarized: 11,
      chaptersTotal: 15,
    });
  });

  it('is a no-op on a delta that arrives before the opening snapshot', () => {
    expect(
      fold(null, {
        ...base,
        type: 'stage_progress',
        stage: 'summarizing',
        done: 3,
        total: 15,
        unit: 'chapters',
      } as IngestEvent),
    ).toBeNull();
  });

  it('seeds the whole view from the snapshot frame', () => {
    expect(
      fold(null, {
        ...base,
        type: 'snapshot',
        status: 'summarizing',
        stage: 'summarizing',
        progress: null,
        chaptersTotal: 15,
        chaptersSummarized: 11,
        title: 'A Book',
        author: 'An Author',
        failedStage: null,
        failureReason: null,
      } as IngestEvent),
    ).toEqual(snapshot);
  });
});
