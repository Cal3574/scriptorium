import { DoclingClient } from './docling-client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeFetch(
  responses: Record<string, Response[] | Response>,
): typeof fetch {
  const queues = new Map(
    Object.entries(responses).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : [value],
    ]),
  );
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const key = Object.keys(responses).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected fetch to ${url}`);
    const queue = queues.get(key) ?? [];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (!next) throw new Error(`no queued response for ${url}`);
    return next;
  }) as typeof fetch;
}

const document = { texts: [], groups: [], tables: [], pictures: [], body: { self_ref: '#/body', children: [] } };

describe('DoclingClient', () => {
  it('submits, polls to success, and fetches the result', async () => {
    const fetchImpl = makeFetch({
      '/v1/convert/file/async': jsonResponse({ task_id: 't1' }),
      '/v1/status/poll/t1': [
        jsonResponse({ task_status: 'started' }),
        jsonResponse({ task_status: 'success' }),
      ],
      '/v1/result/t1': jsonResponse({
        status: 'success',
        document: { json_content: document },
      }),
    });

    const client = new DoclingClient({
      baseUrl: 'http://docling.local',
      fetchImpl,
      sleep: async () => undefined,
    });

    const result = await client.convert(new Uint8Array([1]), 'book.pdf');
    expect(result).toEqual(document);
  });

  it('fetches the artifact-storage shape (documents[].artifacts[].uri) without the docling API key', async () => {
    const capturedHeaders: Record<string, Headers> = {};
    const fetchImpl = (async (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => {
      const url = String(input);
      capturedHeaders[url] = new Headers(init?.headers);
      if (url.includes('/v1/convert/file/async')) {
        return jsonResponse({ task_id: 't1' });
      }
      if (url.includes('/v1/status/poll/t1')) {
        return jsonResponse({ task_status: 'success' });
      }
      if (url.includes('/v1/result/t1')) {
        return jsonResponse({
          num_succeeded: 1,
          documents: [
            {
              status: 'success',
              artifacts: [
                { artifact_type: 'json', uri: 'https://storage.example/artifact.json' },
              ],
            },
          ],
        });
      }
      if (url === 'https://storage.example/artifact.json') {
        return jsonResponse(document);
      }
      throw new Error(`unexpected fetch to ${url}`);
    }) as typeof fetch;

    const client = new DoclingClient({
      baseUrl: 'http://docling.local',
      apiKey: 'dk-test',
      fetchImpl,
      sleep: async () => undefined,
    });

    const result = await client.convert(new Uint8Array([1]), 'book.pdf');
    expect(result).toEqual(document);
    expect(
      capturedHeaders['https://storage.example/artifact.json'].has(
        'X-Api-Key',
      ),
    ).toBe(false);
    expect(capturedHeaders['http://docling.local/v1/result/t1'].get('X-Api-Key')).toBe(
      'dk-test',
    );
  });

  it('throws non-retryable for an artifact-storage document status of failure', async () => {
    const fetchImpl = makeFetch({
      '/v1/convert/file/async': jsonResponse({ task_id: 't1' }),
      '/v1/status/poll/t1': jsonResponse({ task_status: 'success' }),
      '/v1/result/t1': jsonResponse({
        documents: [
          { status: 'failure', errors: [{ message: 'corrupt PDF' }] },
        ],
      }),
    });

    const client = new DoclingClient({
      baseUrl: 'http://docling.local',
      fetchImpl,
      sleep: async () => undefined,
    });

    await expect(
      client.convert(new Uint8Array([1]), 'book.pdf'),
    ).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining('corrupt PDF'),
    });
  });

  it('throws non-retryable when docling reports a task failure', async () => {
    const fetchImpl = makeFetch({
      '/v1/convert/file/async': jsonResponse({ task_id: 't1' }),
      '/v1/status/poll/t1': jsonResponse({ task_status: 'failure' }),
      '/v1/result/t1': jsonResponse({
        status: 'failure',
        errors: [{ message: 'password protected' }],
      }),
    });

    const client = new DoclingClient({
      baseUrl: 'http://docling.local',
      fetchImpl,
      sleep: async () => undefined,
    });

    await expect(
      client.convert(new Uint8Array([1]), 'book.pdf'),
    ).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining('password protected'),
    });
  });

  it('throws retryable on a 503 from docling-serve', async () => {
    const fetchImpl = makeFetch({
      '/v1/convert/file/async': jsonResponse({ error: 'unavailable' }, 503),
    });

    const client = new DoclingClient({
      baseUrl: 'http://docling.local',
      fetchImpl,
      sleep: async () => undefined,
    });

    await expect(
      client.convert(new Uint8Array([1]), 'book.pdf'),
    ).rejects.toMatchObject({ retryable: true });
  });

  it('throws non-retryable on a 400 from docling-serve', async () => {
    const fetchImpl = makeFetch({
      '/v1/convert/file/async': jsonResponse({ error: 'bad request' }, 400),
    });

    const client = new DoclingClient({
      baseUrl: 'http://docling.local',
      fetchImpl,
      sleep: async () => undefined,
    });

    await expect(
      client.convert(new Uint8Array([1]), 'book.pdf'),
    ).rejects.toMatchObject({ retryable: false });
  });

  it('throws retryable when the network request fails outright', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;

    const client = new DoclingClient({
      baseUrl: 'http://docling.local',
      fetchImpl,
      sleep: async () => undefined,
    });

    await expect(
      client.convert(new Uint8Array([1]), 'book.pdf'),
    ).rejects.toMatchObject({ retryable: true });
  });

  it('throws non-retryable when polling exceeds the poll timeout', async () => {
    const fetchImpl = makeFetch({
      '/v1/convert/file/async': jsonResponse({ task_id: 't1' }),
      '/v1/status/poll/t1': jsonResponse({ task_status: 'started' }),
    });

    const client = new DoclingClient({
      baseUrl: 'http://docling.local',
      fetchImpl,
      sleep: async () => undefined,
      pollIntervalMs: 1_000,
      pollTimeoutMs: 0,
    });

    await expect(
      client.convert(new Uint8Array([1]), 'book.pdf'),
    ).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining('timed out'),
    });
  });

  it('sends the expected form fields, options, and API key header', async () => {
    let capturedForm: FormData | undefined;
    const capturedHeaders: Headers[] = [];
    const fetchImpl = (async (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => {
      capturedHeaders.push(new Headers(init?.headers));
      const url = String(input);
      if (url.includes('/v1/convert/file/async')) {
        capturedForm = init?.body as FormData;
        return jsonResponse({ task_id: 't1' });
      }
      if (url.includes('/v1/status/poll/t1')) {
        return jsonResponse({ task_status: 'success' });
      }
      return jsonResponse({
        status: 'success',
        document: { json_content: document },
      });
    }) as typeof fetch;

    const client = new DoclingClient({
      baseUrl: 'http://docling.local/',
      apiKey: 'dk-test',
      fetchImpl,
      sleep: async () => undefined,
      documentTimeoutSeconds: 120,
    });

    await client.convert(new Uint8Array([1]), 'book.pdf');

    expect(capturedForm?.get('to_formats')).toBe('json');
    expect(capturedForm?.get('do_ocr')).toBe('true');
    expect(capturedForm?.get('table_mode')).toBe('accurate');
    expect(capturedForm?.get('document_timeout')).toBe('120');
    for (const headers of capturedHeaders) {
      expect(headers.get('X-Api-Key')).toBe('dk-test');
    }
  });

  it('omits the X-Api-Key header when no apiKey is configured', async () => {
    let capturedHeaders: Headers | undefined;
    const fetchImpl = (async (
      _input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => {
      capturedHeaders = new Headers(init?.headers);
      return jsonResponse({ task_id: 't1' });
    }) as typeof fetch;

    const client = new DoclingClient({
      baseUrl: 'http://docling.local',
      fetchImpl,
      sleep: async () => undefined,
      pollTimeoutMs: 0,
    });

    // pollTimeoutMs: 0 bails out of pollUntilDone on its first check - the
    // submit request that already ran is enough to assert on.
    await expect(
      client.convert(new Uint8Array([1]), 'book.pdf'),
    ).rejects.toMatchObject({ retryable: false });
    expect(capturedHeaders?.has('X-Api-Key')).toBe(false);
  });

  it('does not client-side time out before a longer configured document timeout elapses', async () => {
    // documentTimeoutSeconds=1800 (30 min) must not be cut short by a poll
    // deadline hardcoded shorter than that - the default pollTimeoutMs is
    // derived from it instead. Simulate 26 minutes of elapsed wall-clock time
    // (past a hardcoded 25-minute deadline) via a mocked Date.now advanced by
    // the injected `sleep`.
    const start = Date.now();
    let now = start;
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    const fetchImpl = makeFetch({
      '/v1/convert/file/async': jsonResponse({ task_id: 't1' }),
      '/v1/status/poll/t1': [
        jsonResponse({ task_status: 'started' }),
        jsonResponse({ task_status: 'started' }),
        jsonResponse({ task_status: 'success' }),
      ],
      '/v1/result/t1': jsonResponse({
        status: 'success',
        document: { json_content: document },
      }),
    });

    const client = new DoclingClient({
      baseUrl: 'http://docling.local',
      fetchImpl,
      documentTimeoutSeconds: 1_800,
      pollIntervalMs: 13 * 60 * 1_000,
      sleep: async (ms) => {
        now += ms;
      },
    });

    const result = await client.convert(new Uint8Array([1]), 'book.pdf');
    expect(result).toEqual(document);
    expect(now - start).toBeGreaterThan(25 * 60 * 1_000);

    jest.restoreAllMocks();
  });

  it('retries a transient poll failure in place instead of resubmitting', async () => {
    let submitCount = 0;
    let pollCount = 0;
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes('/v1/convert/file/async')) {
        submitCount++;
        return jsonResponse({ task_id: 't1' });
      }
      if (url.includes('/v1/status/poll/t1')) {
        pollCount++;
        if (pollCount === 1) return jsonResponse({ error: 'unavailable' }, 503);
        return jsonResponse({ task_status: 'success' });
      }
      return jsonResponse({
        status: 'success',
        document: { json_content: document },
      });
    }) as typeof fetch;

    const client = new DoclingClient({
      baseUrl: 'http://docling.local',
      fetchImpl,
      sleep: async () => undefined,
    });

    const result = await client.convert(new Uint8Array([1]), 'book.pdf');
    expect(result).toEqual(document);
    expect(submitCount).toBe(1);
    expect(pollCount).toBe(2);
  });
});
