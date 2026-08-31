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
});
