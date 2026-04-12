/**
 * Agent Provider Factory
 *
 * Dynamically instantiates the appropriate agent provider based on type string.
 * Supports Claude and Codex providers.
 */
import type { IAgentProvider } from '../types';
import { ClaudeProvider } from './claude';
import { CodexProvider } from './codex';
import { CopilotProvider } from './copilot';
import { createLogger } from '@archon/paths';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('provider.factory');
  return cachedLog;
}

/**
 * Get the appropriate agent provider based on type
 *
 * @param type - Provider type identifier ('claude' or 'codex')
 * @returns Instantiated agent provider
 * @throws Error if provider type is unknown
 */
export function getAgentProvider(type: string): IAgentProvider {
  switch (type) {
    case 'claude':
      getLog().debug({ provider: 'claude' }, 'provider_selected');
      return new ClaudeProvider();
    case 'codex':
      getLog().debug({ provider: 'codex' }, 'provider_selected');
      return new CodexProvider();
    case 'copilot':
      getLog().debug({ provider: 'copilot' }, 'provider_selected');
      return new CopilotProvider();
    default:
      throw new Error(
        `Unknown provider type: ${type}. Supported types: 'claude', 'codex', 'copilot'`
      );
  }
}
