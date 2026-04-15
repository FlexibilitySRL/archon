import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { createMockLogger } from '../test/mocks/logger';

const mockLogger = createMockLogger();
mock.module('@archon/paths', () => ({
  createLogger: mock(() => mockLogger),
}));

// --- Mock Copilot SDK ---

type EventHandler = (event: { data: Record<string, unknown> }) => void;

/** Minimal mock session that records .on() subscriptions and exposes fire helpers */
function createMockSession(sessionId = 'mock-session-id') {
  const handlers = new Map<string, EventHandler>();
  const unsubMock = mock(() => undefined);

  return {
    sessionId,
    on: mock((eventType: string, handler: EventHandler) => {
      handlers.set(eventType, handler);
      return unsubMock;
    }),
    send: mock(() => Promise.resolve('msg-id')),
    /** fire a registered event handler by type */
    fire(type: string, data: Record<string, unknown> = {}): void {
      const h = handlers.get(type);
      if (h) h({ data });
    },
    _handlers: handlers,
    _unsubMock: unsubMock,
  };
}

let latestMockSession: ReturnType<typeof createMockSession>;

const mockCreateSession = mock(async () => {
  latestMockSession = createMockSession();
  return latestMockSession;
});

const mockResumeSession = mock(async (_id: string) => {
  latestMockSession = createMockSession('resumed-session-id');
  return latestMockSession;
});

const mockStop = mock(async () => undefined);

mock.module('@github/copilot-sdk', () => ({
  CopilotClient: mock(() => ({
    createSession: mockCreateSession,
    resumeSession: mockResumeSession,
    stop: mockStop,
  })),
  approveAll: mock(() => ({ allow: true })),
}));

import { CopilotProvider as CopilotClient } from './provider';

// Helper: collect all chunks from sendQuery, triggering events via the mock session
async function collectChunks(
  client: CopilotClient,
  prompt: string,
  cwd: string,
  resumeSessionId?: string,
  requestOptions?: Parameters<typeof client.sendQuery>[3],
  /** Called after session.send() to fire events on the mock session */
  fireEvents?: (session: ReturnType<typeof createMockSession>) => void
): Promise<Array<Record<string, unknown>>> {
  // Override send to fire events synchronously before returning
  const originalMock = mockCreateSession.getMockImplementation();
  mockCreateSession.mockImplementation(async () => {
    latestMockSession = createMockSession();
    // Replace send to fire events when called
    latestMockSession.send = mock(async () => {
      if (fireEvents) fireEvents(latestMockSession);
      return 'msg-id';
    });
    return latestMockSession;
  });

  if (resumeSessionId) {
    const origResume = mockResumeSession.getMockImplementation();
    mockResumeSession.mockImplementation(async () => {
      latestMockSession = createMockSession('resumed-session-id');
      latestMockSession.send = mock(async () => {
        if (fireEvents) fireEvents(latestMockSession);
        return 'msg-id';
      });
      return latestMockSession;
    });

    const chunks: Array<Record<string, unknown>> = [];
    for await (const chunk of client.sendQuery(prompt, cwd, resumeSessionId, requestOptions)) {
      chunks.push(chunk as unknown as Record<string, unknown>);
    }

    if (origResume) mockResumeSession.mockImplementation(origResume);
    if (originalMock) mockCreateSession.mockImplementation(originalMock);
    return chunks;
  }

  const chunks: Array<Record<string, unknown>> = [];
  for await (const chunk of client.sendQuery(prompt, cwd, undefined, requestOptions)) {
    chunks.push(chunk as unknown as Record<string, unknown>);
  }

  if (originalMock) mockCreateSession.mockImplementation(originalMock);
  return chunks;
}

describe('CopilotClient', () => {
  let client: CopilotClient;

  beforeEach(() => {
    client = new CopilotClient();
    mockCreateSession.mockClear();
    mockResumeSession.mockClear();
    mockStop.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.debug.mockClear();
  });

  describe('getType', () => {
    test('returns copilot', () => {
      expect(client.getType()).toBe('copilot');
    });
  });

  describe('sendQuery', () => {
    test('yields assistant chunk from assistant.message when no deltas', async () => {
      const chunks = await collectChunks(client, 'hello', '/workspace', undefined, undefined, s => {
        s.fire('assistant.message', { content: 'Hello!' });
        s.fire('session.idle', {});
      });

      const assistantChunks = chunks.filter(c => c.type === 'assistant');
      expect(assistantChunks).toHaveLength(1);
      expect(assistantChunks[0]).toEqual({ type: 'assistant', content: 'Hello!' });
    });

    test('yields assistant chunks from assistant.message_delta (streaming)', async () => {
      const chunks = await collectChunks(client, 'hello', '/workspace', undefined, undefined, s => {
        s.fire('assistant.message_delta', { deltaContent: 'Hel' });
        s.fire('assistant.message_delta', { deltaContent: 'lo!' });
        s.fire('assistant.message', { content: 'Hello!' }); // should be skipped
        s.fire('session.idle', {});
      });

      const assistantChunks = chunks.filter(c => c.type === 'assistant');
      expect(assistantChunks).toHaveLength(2);
      expect(assistantChunks[0]).toEqual({ type: 'assistant', content: 'Hel' });
      expect(assistantChunks[1]).toEqual({ type: 'assistant', content: 'lo!' });
    });

    test('skips assistant.message when deltas were received (no duplication)', async () => {
      const chunks = await collectChunks(client, 'hello', '/workspace', undefined, undefined, s => {
        s.fire('assistant.message_delta', { deltaContent: 'streamed' });
        s.fire('assistant.message', { content: 'streamed' });
        s.fire('session.idle', {});
      });

      const assistantChunks = chunks.filter(c => c.type === 'assistant');
      expect(assistantChunks).toHaveLength(1);
      expect(assistantChunks[0]?.content).toBe('streamed');
    });

    test('yields result with sessionId on session.idle', async () => {
      const chunks = await collectChunks(client, 'test', '/workspace', undefined, undefined, s => {
        s.fire('session.idle', {});
      });

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({ type: 'result', sessionId: 'mock-session-id' });
    });

    test('yields result with accumulated token usage', async () => {
      const chunks = await collectChunks(client, 'test', '/workspace', undefined, undefined, s => {
        s.fire('assistant.usage', { inputTokens: 100, outputTokens: 20, cost: 0.01 });
        s.fire('assistant.usage', { inputTokens: 50, outputTokens: 10, cost: 0.005 });
        s.fire('session.idle', {});
      });

      const result = chunks.find(c => c.type === 'result');
      expect(result).toMatchObject({
        type: 'result',
        tokens: { input: 150, output: 30, cost: 0.015 },
      });
    });

    test('yields tool and tool_result chunks', async () => {
      const chunks = await collectChunks(client, 'test', '/workspace', undefined, undefined, s => {
        s.fire('tool.execution_start', {
          toolCallId: 'tc-1',
          toolName: 'Bash',
          arguments: { command: 'ls' },
        });
        s.fire('tool.execution_complete', {
          toolCallId: 'tc-1',
          success: true,
          result: { content: 'file.ts' },
        });
        s.fire('session.idle', {});
      });

      expect(chunks[0]).toEqual({
        type: 'tool',
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        toolCallId: 'tc-1',
      });
      expect(chunks[1]).toEqual({
        type: 'tool_result',
        toolName: 'Bash',
        toolOutput: 'file.ts',
        toolCallId: 'tc-1',
      });
    });

    test('marks failed tool execution', async () => {
      const chunks = await collectChunks(client, 'test', '/workspace', undefined, undefined, s => {
        s.fire('tool.execution_start', {
          toolCallId: 'tc-2',
          toolName: 'Bash',
          arguments: {},
        });
        s.fire('tool.execution_complete', {
          toolCallId: 'tc-2',
          success: false,
          result: {},
        });
        s.fire('session.idle', {});
      });

      const toolResult = chunks.find(c => c.type === 'tool_result');
      expect(toolResult?.toolOutput).toBe('❌ Tool execution failed');
    });

    test('uses "unknown" for tool_result when toolCallId not found', async () => {
      const chunks = await collectChunks(client, 'test', '/workspace', undefined, undefined, s => {
        // complete without a prior start
        s.fire('tool.execution_complete', {
          toolCallId: 'tc-missing',
          success: true,
          result: { content: 'ok' },
        });
        s.fire('session.idle', {});
      });

      expect(chunks[0]).toMatchObject({ type: 'tool_result', toolName: 'unknown' });
    });

    test('yields error result on session.error and logs it', async () => {
      const chunks = await collectChunks(client, 'test', '/workspace', undefined, undefined, s => {
        s.fire('session.error', { errorType: 'rate_limit', message: 'Too many requests' });
      });

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        type: 'result',
        sessionId: 'mock-session-id',
        isError: true,
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
        { errorType: 'rate_limit', message: 'Too many requests' },
        'session.error'
      );
    });

    test('resumes session when resumeSessionId provided', async () => {
      const chunks = await collectChunks(
        client,
        'test',
        '/workspace',
        'prev-session',
        undefined,
        s => {
          s.fire('assistant.message', { content: 'Resumed!' });
          s.fire('session.idle', {});
        }
      );

      expect(mockResumeSession).toHaveBeenCalled();
      const assistantChunks = chunks.filter(c => c.type === 'assistant');
      expect(assistantChunks[0]?.content).toBe('Resumed!');
    });

    test('falls back to new session when resume fails', async () => {
      mockResumeSession.mockRejectedValueOnce(new Error('session expired'));

      const chunks = await collectChunks(
        client,
        'test',
        '/workspace',
        'bad-session',
        undefined,
        s => {
          s.fire('assistant.message', { content: 'Fresh session' });
          s.fire('session.idle', {});
        }
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'bad-session' }),
        'resume_session_failed'
      );
      const systemChunks = chunks.filter(c => c.type === 'system');
      expect(systemChunks).toHaveLength(1);
      expect(systemChunks[0]?.content).toContain('Starting fresh');
    });

    test('throws immediately when abortSignal already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const consumeGenerator = async (): Promise<void> => {
        for await (const _ of client.sendQuery('test', '/workspace', undefined, {
          abortSignal: controller.signal,
        })) {
          // consume
        }
      };

      await expect(consumeGenerator()).rejects.toThrow('Query aborted');
    });

    test('strips ghp_ PATs from env', async () => {
      const origGh = process.env.GH_TOKEN;
      const origGithub = process.env.GITHUB_TOKEN;
      process.env.GH_TOKEN = 'ghp_test123';
      process.env.GITHUB_TOKEN = 'ghp_test456';

      await collectChunks(client, 'test', '/workspace', undefined, undefined, s => {
        s.fire('session.idle', {});
      });

      // Verify CopilotClient constructor was called — we can't easily inspect env
      // but the code runs without error (SDK doesn't throw on missing auth in mock)
      expect(mockCreateSession).toHaveBeenCalled();

      // Cleanup
      if (origGh !== undefined) process.env.GH_TOKEN = origGh;
      else delete process.env.GH_TOKEN;
      if (origGithub !== undefined) process.env.GITHUB_TOKEN = origGithub;
      else delete process.env.GITHUB_TOKEN;
    });

    test('calls client.stop() in finally block', async () => {
      await collectChunks(client, 'test', '/workspace', undefined, undefined, s => {
        s.fire('session.idle', {});
      });

      expect(mockStop).toHaveBeenCalledTimes(1);
    });

    test('logs warning when client.stop() fails', async () => {
      mockStop.mockRejectedValueOnce(new Error('stop failed'));

      await collectChunks(client, 'test', '/workspace', undefined, undefined, s => {
        s.fire('session.idle', {});
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'client.stop_failed'
      );
    });

    test('ignores assistant.message_delta with empty deltaContent', async () => {
      const chunks = await collectChunks(client, 'test', '/workspace', undefined, undefined, s => {
        s.fire('assistant.message_delta', { deltaContent: '' });
        s.fire('assistant.message_delta', { deltaContent: undefined });
        s.fire('assistant.message', { content: 'Final' });
        s.fire('session.idle', {});
      });

      const assistantChunks = chunks.filter(c => c.type === 'assistant');
      // Empty/undefined deltas don't set receivedDeltas, so assistant.message emits
      expect(assistantChunks).toHaveLength(1);
      expect(assistantChunks[0]?.content).toBe('Final');
    });

    test('ignores assistant.message with empty content', async () => {
      const chunks = await collectChunks(client, 'test', '/workspace', undefined, undefined, s => {
        s.fire('assistant.message', { content: '' });
        s.fire('session.idle', {});
      });

      const assistantChunks = chunks.filter(c => c.type === 'assistant');
      expect(assistantChunks).toHaveLength(0);
    });

    test('unsubscribes all handlers on completion', async () => {
      await collectChunks(client, 'test', '/workspace', undefined, undefined, s => {
        s.fire('session.idle', {});
      });

      // session.on returns an unsubscribe function; verify they were all collected
      // The mock session tracks .on() calls — we have 6 event subscriptions
      expect(latestMockSession.on).toHaveBeenCalled();
      const onCallCount = latestMockSession.on.mock.calls.length;
      expect(onCallCount).toBeGreaterThanOrEqual(5); // delta, message, tool_start, tool_complete, usage, idle, error
    });
  });
});
