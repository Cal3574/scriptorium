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

    storage.simulateUpload(key, 4096);
    expect(await storage.headObject(key)).toEqual({ contentLength: 4096 });

    storage.removeObject(key);
    expect(await storage.headObject(key)).toBeNull();
  });

  it('round-trips bytes through putObject / getObject', async () => {
    const storage = new FakeObjectStorage();
    const markdownKey = 'books/user-1/abc.md';
    expect(await storage.getObject(markdownKey)).toBeNull();

    const body = Buffer.from('# Title\n\n## Chapter 1\n', 'utf-8');
    await storage.putObject(markdownKey, body, 'text/markdown');

    const readBack = await storage.getObject(markdownKey);
    expect(readBack).not.toBeNull();
    expect(Buffer.from(readBack as Uint8Array).toString()).toBe(
      '# Title\n\n## Chapter 1\n',
    );
    expect(await storage.headObject(markdownKey)).toEqual({
      contentLength: body.length,
    });
  });

  it('putObject copies the incoming bytes so later mutation is not seen', async () => {
    const storage = new FakeObjectStorage();
    const body = Buffer.from('original');
    await storage.putObject(key, body, 'application/octet-stream');
    body.fill(0);
    const readBack = await storage.getObject(key);
    expect(Buffer.from(readBack as Uint8Array).toString()).toBe('original');
  });
});
