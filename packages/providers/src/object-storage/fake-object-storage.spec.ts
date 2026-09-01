import { FakeObjectStorage } from './fake-object-storage.js';

describe('FakeObjectStorage', () => {
  const key = 'books/user-1/abc.pdf';

  it('points the presigned URL at the api dev upload route', async () => {
    const storage = new FakeObjectStorage({
      publicBaseUrl: 'http://localhost:3000',
    });
    const url = await storage.createPresignedPutUrl({
      key,
      contentType: 'application/pdf',
      expiresInSeconds: 300,
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe('http://localhost:3000');
    expect(parsed.pathname).toBe(`/api/v1/_dev/uploads/${key}`);
    expect(parsed.searchParams.get('contentType')).toBe('application/pdf');
    expect(storage.presigned).toHaveLength(1);
  });

  it('headObject resolves null until a PUT is simulated', async () => {
    const storage = new FakeObjectStorage();
    expect(await storage.headObject(key)).toBeNull();

    storage.putObject(key, 4096);
    expect(await storage.headObject(key)).toEqual({ contentLength: 4096 });

    storage.removeObject(key);
    expect(await storage.headObject(key)).toBeNull();
  });
});
