import { FakeLlmClient } from './fake-llm-client.js';
import type { LlmRequest } from './llm-client.js';

const summaryRequest: LlmRequest = {
  messages: [
    {
      role: 'user',
      content: [
        '# The Quiet Craft of Habit',
        '',
        '## Chapter 1. Starting Small',
        '',
        'The hardest part of any habit is the first repetition. A tiny action today makes it easier tomorrow.',
      ].join('\n'),
    },
  ],
};

const synthesisRequest: LlmRequest = {
  system: 'You are a research assistant.',
  messages: [
    {
      role: 'user',
      content: [
        'Question: how do these books describe habit formation?',
        '',
        '[1] The Quiet Craft of Habit - Chapter 2. The Shape of a Cue',
        'Habits hang from cues.',
        '',
        '[2] The Art of War - Chapter IX. The Army on the March',
        'Discipline is built by routine.',
      ].join('\n'),
    },
  ],
};

describe('FakeLlmClient', () => {
  const client = new FakeLlmClient({ delayMs: 0 });

  describe('complete', () => {
    it('echoes book title, heading and first sentence into templated markdown', async () => {
      const out = await client.complete(summaryRequest);
      expect(out).toContain('The Quiet Craft of Habit');
      expect(out).toContain('Chapter 1. Starting Small');
      expect(out).toContain(
        'The hardest part of any habit is the first repetition.',
      );
      expect(out.startsWith('## ')).toBe(true);
    });

    it('produces distinct output per chapter', async () => {
      const other = await client.complete({
        messages: [
          {
            role: 'user',
            content:
              '# The Quiet Craft of Habit\n\n## Chapter 7. Keeping the Thread\n\nNo streak survives forever.',
          },
        ],
      });
      const first = await client.complete(summaryRequest);
      expect(other).not.toEqual(first);
      expect(other).toContain('Keeping the Thread');
    });

    it('does not resolve until the configured delay elapses', async () => {
      jest.useFakeTimers();
      try {
        const slow = new FakeLlmClient({ delayMs: 50 });
        let resolved = false;
        const pending = slow.complete(summaryRequest).then(() => {
          resolved = true;
        });
        await jest.advanceTimersByTimeAsync(49);
        expect(resolved).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        await pending;
        expect(resolved).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('stream', () => {
    it('yields multiple deltas that concatenate to the full answer', async () => {
      const deltas: string[] = [];
      for await (const delta of client.stream(synthesisRequest)) {
        deltas.push(delta);
      }
      expect(deltas.length).toBeGreaterThan(1);

      const full = deltas.join('');
      expect(full).toContain('[1]');
      expect(full).toContain('[2]');
      expect(full).toContain('The Shape of a Cue');
      expect(full).toContain('The Army on the March');
      // echoes the salient input - the question
      expect(full).toContain('how do these books describe habit formation?');
    });

    it('streams the same content complete() would return', async () => {
      let streamed = '';
      for await (const delta of client.stream(synthesisRequest))
        streamed += delta;
      expect(streamed).toEqual(await client.complete(synthesisRequest));
    });
  });
});
