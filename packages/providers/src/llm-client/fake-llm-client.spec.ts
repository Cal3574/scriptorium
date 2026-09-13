import {
  FAKE_LLM_FAILURE_MARKER,
  FakeLlmClient,
  FakeLlmFailure,
} from './fake-llm-client.js';
import type { LlmRequest } from './llm-client.js';

// Matches the api app's `AGENT_SYSTEM_PROMPT` on the phrase the fake branches
// on. Kept short here - the real prompt is the api app's to own.
const AGENT_SYSTEM = 'You are a reading companion: a thinking partner.';

const agentRequest: LlmRequest = {
  system: AGENT_SYSTEM,
  messages: [
    {
      role: 'user',
      content: [
        'Highlighted passage:',
        '"""',
        'No streak survives forever.',
        '"""',
        '',
        'Reader: this stung more than it should have',
      ].join('\n'),
    },
  ],
};

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

  describe('agent shape', () => {
    it('answers in the companion voice: reacts to the reader, asks back, no markers', async () => {
      const out = await client.complete(agentRequest);

      expect(out).toContain('this stung more than it should have');
      expect(out).toContain('?');
      expect(out).not.toMatch(/\[\d+\]/);
      // Reacts to the highlight rather than restating the passage.
      expect(out).not.toContain('No streak survives forever.');
    });

    it('does not fall into the synthesis shape', async () => {
      const out = await client.complete(agentRequest);
      expect(out).not.toContain('Passages consulted');
      expect(out).not.toContain('FakeLlmClient');
    });

    it('produces a different reply once prior turns are replayed as history', async () => {
      const withHistory = await client.complete({
        system: AGENT_SYSTEM,
        messages: [
          { role: 'user', content: 'Reader: opening question' },
          { role: 'assistant', content: 'a reply' },
          ...agentRequest.messages,
        ],
      });

      expect(withHistory).not.toEqual(await client.complete(agentRequest));
    });
  });

  describe('agent context-window summary shape (#158)', () => {
    // Kept in sync with `context-window.ts`'s `SUMMARY_SYSTEM_PROMPT` on the
    // phrase the fake branches on, matching how `AGENT_SYSTEM` above mirrors
    // the live `AGENT_SYSTEM_PROMPT`.
    const SUMMARY_SYSTEM =
      'You maintain a rolling summary of an ongoing conversation.';

    it('does not fall into the agent-reply shape, even without "system" naming it a companion', async () => {
      const out = await client.complete({
        system: SUMMARY_SYSTEM,
        messages: [
          {
            role: 'user',
            content: 'Turns to summarise:\nReader: hello\nCompanion: hi',
          },
        ],
      });

      expect(out).not.toContain('?');
      expect(out).toContain('1 earlier turn');
    });

    it('reports how many turns it was asked to fold in', async () => {
      const out = await client.complete({
        system: SUMMARY_SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              'Turns to summarise:',
              'Reader: a',
              'Companion: b',
              '',
              'Reader: c',
              'Companion: d',
            ].join('\n'),
          },
        ],
      });

      expect(out).toContain('2 earlier turn');
    });

    it('reports when it is merging with a prior summary rather than starting fresh', async () => {
      const fresh = await client.complete({
        system: SUMMARY_SYSTEM,
        messages: [
          {
            role: 'user',
            content: 'Turns to summarise:\nReader: a\nCompanion: b',
          },
        ],
      });
      const merged = await client.complete({
        system: SUMMARY_SYSTEM,
        messages: [
          {
            role: 'user',
            content:
              'Previous summary:\nearlier stuff\n\nNew turns to fold in:\nReader: a\nCompanion: b',
          },
        ],
      });

      expect(fresh).not.toContain('merged with the prior summary');
      expect(merged).toContain('merged with the prior summary');
    });
  });

  describe('failure injection', () => {
    const failing: LlmRequest = {
      system: AGENT_SYSTEM,
      messages: [
        { role: 'user', content: `Reader: ${FAKE_LLM_FAILURE_MARKER}` },
      ],
    };

    it('rejects complete()', async () => {
      await expect(client.complete(failing)).rejects.toThrow(FakeLlmFailure);
    });

    it('rejects stream() before yielding any delta', async () => {
      const deltas: string[] = [];
      await expect(
        (async () => {
          for await (const delta of client.stream(failing)) deltas.push(delta);
        })(),
      ).rejects.toThrow(FakeLlmFailure);
      expect(deltas).toEqual([]);
    });
  });
});
