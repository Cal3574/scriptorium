import { FakeQueue } from './fake-queue.js';

const bookId = '11111111-1111-4111-8111-111111111111';

describe('FakeQueue', () => {
  it('records ingest and delete enqueues under distinct jobIds', async () => {
    const q = new FakeQueue();
    await q.enqueueIngest({ bookId });
    await q.enqueueDelete({ bookId });
    expect(q.recorded).toEqual([
      { name: 'ingest', jobId: bookId, data: { bookId } },
      { name: 'delete', jobId: `delete:${bookId}`, data: { bookId } },
    ]);
  });

  it('drops a duplicate enqueue for the same jobId', async () => {
    const q = new FakeQueue();
    await q.enqueueIngest({ bookId });
    await q.enqueueIngest({ bookId, requestId: bookId });
    expect(q.recorded).toHaveLength(1);
  });

  it('re-enqueues an ingest job whose previous run has finished', async () => {
    const q = new FakeQueue();
    await q.enqueueIngest({ bookId });
    q.setIngestJobState(bookId, 'completed');

    // A plain enqueue would be swallowed as a duplicate...
    await q.enqueueIngest({ bookId });
    expect(q.recorded).toHaveLength(1);

    // ...but a re-enqueue drops the finished job and adds a fresh one.
    await q.reenqueueIngest({ bookId, requestId: bookId });
    expect(q.recorded).toEqual([
      { name: 'ingest', jobId: bookId, data: { bookId, requestId: bookId } },
    ]);
    expect(await q.ingestJobStatus(bookId)).toBe('waiting');
  });

  describe('ingest-job control', () => {
    it('reports missing for a book with no ingest job', async () => {
      const q = new FakeQueue();
      expect(await q.ingestJobStatus(bookId)).toBe('missing');
    });

    it('reports a fresh ingest job as waiting', async () => {
      const q = new FakeQueue();
      await q.enqueueIngest({ bookId });
      expect(await q.ingestJobStatus(bookId)).toBe('waiting');
    });

    it('removes a waiting ingest job and forgets it', async () => {
      const q = new FakeQueue();
      await q.enqueueIngest({ bookId });

      expect(await q.removeIngestJob(bookId)).toBe(true);
      expect(await q.ingestJobStatus(bookId)).toBe('missing');
      expect(q.recorded).toHaveLength(0);
    });

    it('will not remove an active ingest job', async () => {
      const q = new FakeQueue();
      await q.enqueueIngest({ bookId });
      q.setIngestJobState(bookId, 'active');

      expect(await q.removeIngestJob(bookId)).toBe(false);
      expect(await q.ingestJobStatus(bookId)).toBe('active');
    });
  });
});
