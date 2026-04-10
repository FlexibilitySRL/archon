/**
 * GitHub Copilot SDK wrapper
 * Bridges Copilot's event-handler model to Archon's async generator interface.
 *
 * Authentication:
 * - SDK auto-detects GH_TOKEN from the environment.
 * - No explicit token configuration needed if GH_TOKEN is set.
 *
 * Session model differences from Claude/Codex:
 * - No async iterator — uses session.on() event subscriptions
 * - tool.execution_complete does not carry toolName; tracked via execution_start map
 * - session.idle signals turn completion (analogous to Claude's result / Codex's turn.completed)
 */
import {
  CopilotClient as CopilotSdk,
  approveAll,
  type SessionConfig,
  type ResumeSessionConfig,
  type SessionEventPayload,
} from '@github/copilot-sdk';
import {
  type AssistantRequestOptions,
  type IAssistantClient,
  type MessageChunk,
  type TokenUsage,
} from '../types';
import { createLogger } from '@archon/paths';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('client.copilot');
  return cachedLog;
}

/**
 * Maps Archon's ModelReasoningEffort to Copilot SDK's ReasoningEffort.
 * Copilot does not support 'minimal' — maps to 'low'.
 */
function mapReasoningEffort(effort: string): SessionConfig['reasoningEffort'] {
  if (effort === 'minimal') return 'low';
  if (effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh') {
    return effort as SessionConfig['reasoningEffort'];
  }
  return undefined;
}

/**
 * Minimal async queue for bridging Copilot event handlers to an async generator.
 * Null sentinel signals end-of-stream.
 */
function createQueue<T>(): {
  push: (item: T | null | Error) => void;
  next: () => Promise<T | null | Error>;
} {
  const items: (T | null | Error)[] = [];
  const waiters: (() => void)[] = [];

  return {
    push(item: T | null | Error): void {
      items.push(item);
      waiters.shift()?.();
    },
    next(): Promise<T | null | Error> {
      const dequeue = (): T | null | Error => {
        const item = items.shift();
        // Queue is non-empty when dequeue is called (guarded by length check and waiter)
        return item !== undefined ? item : null;
      };
      if (items.length > 0) return Promise.resolve(dequeue());
      return new Promise<void>(resolve => waiters.push(resolve)).then(dequeue);
    },
  };
}

function isReasoningUnsupportedError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('does not support reasoning effort');
}

function buildSessionConfig(
  cwd: string,
  requestOptions?: AssistantRequestOptions,
  includeReasoning = true
): SessionConfig {
  return {
    onPermissionRequest: approveAll,
    workingDirectory: cwd,
    ...(requestOptions?.model ? { model: requestOptions.model } : {}),
    ...(includeReasoning && requestOptions?.modelReasoningEffort
      ? { reasoningEffort: mapReasoningEffort(requestOptions.modelReasoningEffort) }
      : {}),
  };
}

async function createSessionWithFallback(
  client: CopilotSdk,
  cwd: string,
  requestOptions: AssistantRequestOptions | undefined,
  queue: ReturnType<typeof createQueue<MessageChunk>>
): Promise<Awaited<ReturnType<typeof client.createSession>>> {
  try {
    return await client.createSession(buildSessionConfig(cwd, requestOptions));
  } catch (err) {
    if (isReasoningUnsupportedError(err)) {
      getLog().warn({ model: requestOptions?.model }, 'session.reasoning_unsupported_fallback');
      queue.push({
        type: 'system',
        content: '⚠️ Model does not support reasoning effort — retrying without it.',
      });
      return await client.createSession(buildSessionConfig(cwd, requestOptions, false));
    }
    throw err;
  }
}

/**
 * GitHub Copilot assistant client.
 * Implements IAssistantClient for use alongside ClaudeClient and CodexClient.
 */
export class CopilotClient implements IAssistantClient {
  /**
   * Send a prompt to Copilot and stream responses as MessageChunks.
   * Creates a new CopilotClient+session per call for isolation.
   */
  async *sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    requestOptions?: AssistantRequestOptions
  ): AsyncGenerator<MessageChunk> {
    if (requestOptions?.abortSignal?.aborted) {
      throw new Error('Query aborted');
    }

    // Classic PATs (ghp_) are not supported by the Copilot API.
    // The SDK subprocess inherits process.env and checks GH_TOKEN / GITHUB_TOKEN
    // before looking for OAuth tokens from `copilot login`. If a ghp_ token is
    // present, we must strip it from the subprocess env so the SDK falls through
    // to the stored OAuth credentials.
    const isPat = (t: string | undefined): boolean => !!t?.startsWith('ghp_');
    const env: Record<string, string | undefined> = { ...process.env };
    if (isPat(env.GH_TOKEN)) env.GH_TOKEN = undefined;
    if (isPat(env.GITHUB_TOKEN)) env.GITHUB_TOKEN = undefined;

    const copilotToken = process.env.COPILOT_GITHUB_TOKEN;
    const client = new CopilotSdk({
      logLevel: 'error',
      env,
      ...(copilotToken ? { githubToken: copilotToken } : {}),
    });

    // toolCallId → toolName: execution_complete doesn't carry toolName
    const pendingTools = new Map<string, string>();
    // accumulate usage across multiple assistant.usage events per turn
    let usageData: TokenUsage | undefined;
    // track whether we received any deltas (to avoid duplicating content from assistant.message)
    let receivedDeltas = false;

    const queue = createQueue<MessageChunk>();

    // --- wire up unsubscribers so we can clean up ---
    const unsubscribers: (() => void)[] = [];

    let session: Awaited<ReturnType<typeof client.createSession>>;

    try {
      if (resumeSessionId) {
        getLog().debug({ sessionId: resumeSessionId }, 'resuming_session');
        try {
          const resumeConfig: ResumeSessionConfig = buildSessionConfig(cwd, requestOptions);
          session = await client.resumeSession(resumeSessionId, resumeConfig);
        } catch (resumeErr) {
          getLog().error({ err: resumeErr, sessionId: resumeSessionId }, 'resume_session_failed');
          session = await createSessionWithFallback(client, cwd, requestOptions, queue);
        }
      } else {
        getLog().debug({ cwd }, 'creating_session');
        session = await createSessionWithFallback(client, cwd, requestOptions, queue);
      }

      // --- subscribe to events ---

      unsubscribers.push(
        session.on(
          'assistant.message_delta',
          (event: SessionEventPayload<'assistant.message_delta'>) => {
            const delta = event.data.deltaContent;
            if (delta) {
              receivedDeltas = true;
              queue.push({ type: 'assistant', content: delta });
            }
          }
        )
      );

      // Capture the final assistant.message — the SDK may skip deltas entirely
      // for short responses, so we emit the full content when no deltas arrived.
      unsubscribers.push(
        session.on('assistant.message', (event: SessionEventPayload<'assistant.message'>) => {
          if (!receivedDeltas && event.data.content) {
            queue.push({ type: 'assistant', content: event.data.content });
          }
        })
      );

      unsubscribers.push(
        session.on('tool.execution_start', (event: SessionEventPayload<'tool.execution_start'>) => {
          const { toolCallId, toolName, arguments: args } = event.data;
          pendingTools.set(toolCallId, toolName);
          queue.push({
            type: 'tool',
            toolName,
            toolInput: args ?? {},
            toolCallId,
          });
        })
      );

      unsubscribers.push(
        session.on(
          'tool.execution_complete',
          (event: SessionEventPayload<'tool.execution_complete'>) => {
            const { toolCallId, success, result } = event.data;
            const toolName = pendingTools.get(toolCallId) ?? 'unknown';
            pendingTools.delete(toolCallId);
            const toolOutput = success ? (result?.content ?? '') : '❌ Tool execution failed';
            queue.push({ type: 'tool_result', toolName, toolOutput, toolCallId });
          }
        )
      );

      unsubscribers.push(
        session.on('assistant.usage', (event: SessionEventPayload<'assistant.usage'>) => {
          const { inputTokens, outputTokens, cost } = event.data;
          // Accumulate across multiple usage events in one turn
          if (typeof inputTokens === 'number' || typeof outputTokens === 'number') {
            usageData = {
              input: (usageData?.input ?? 0) + (inputTokens ?? 0),
              output: (usageData?.output ?? 0) + (outputTokens ?? 0),
              ...(cost !== undefined ? { cost: (usageData?.cost ?? 0) + cost } : {}),
            };
          }
        })
      );

      unsubscribers.push(
        session.on('session.idle', (_event: SessionEventPayload<'session.idle'>) => {
          queue.push({
            type: 'result',
            sessionId: session.sessionId,
            ...(usageData ? { tokens: usageData } : {}),
          });
          queue.push(null); // end-of-stream sentinel
        })
      );

      unsubscribers.push(
        session.on('session.error', (event: SessionEventPayload<'session.error'>) => {
          getLog().error(
            { errorType: event.data.errorType, message: event.data.message },
            'session.error'
          );
          queue.push({ type: 'result', sessionId: session.sessionId, isError: true });
          queue.push(null);
        })
      );

      // Abort support: push an error into the queue when signal fires
      if (requestOptions?.abortSignal) {
        const onAbort = (): void => {
          queue.push(new Error('Query aborted'));
          queue.push(null);
        };
        requestOptions.abortSignal.addEventListener('abort', onAbort, { once: true });
        unsubscribers.push(() => requestOptions.abortSignal?.removeEventListener('abort', onAbort));
      }

      // Send the prompt (non-blocking — events fire asynchronously)
      await session.send({ prompt });

      // Drain the queue
      while (true) {
        const item = await queue.next();
        if (item === null) break;
        if (item instanceof Error) throw item;
        yield item;
      }
    } finally {
      for (const unsub of unsubscribers) unsub();
      try {
        await client.stop();
      } catch (stopErr) {
        getLog().warn({ err: stopErr }, 'client.stop_failed');
      }
    }
  }

  /**
   * List available models from the Copilot SDK.
   * Spins up a temporary client, fetches models, then shuts down.
   */
  async listModels(): Promise<{ id: string; name: string }[]> {
    const isPat = (t: string | undefined): boolean => !!t?.startsWith('ghp_');
    const env: Record<string, string | undefined> = { ...process.env };
    if (isPat(env.GH_TOKEN)) env.GH_TOKEN = undefined;
    if (isPat(env.GITHUB_TOKEN)) env.GITHUB_TOKEN = undefined;

    const copilotToken = process.env.COPILOT_GITHUB_TOKEN;
    const client = new CopilotSdk({
      logLevel: 'error',
      env,
      ...(copilotToken ? { githubToken: copilotToken } : {}),
    });

    try {
      await client.start();
      const models = await client.listModels();
      return models.map(m => ({ id: m.id, name: m.name }));
    } finally {
      try {
        await client.stop();
      } catch (stopErr) {
        getLog().warn({ err: stopErr }, 'client.stop_failed');
      }
    }
  }

  getType(): string {
    return 'copilot';
  }
}
