import { describe, test, expect } from 'bun:test';
import { getAssistantClient } from './factory';

describe('factory', () => {
  describe('getAssistantClient', () => {
    test('returns ClaudeClient for claude type', () => {
      const client = getAssistantClient('claude');

      expect(client).toBeDefined();
      expect(client.getType()).toBe('claude');
      expect(typeof client.sendQuery).toBe('function');
    });

    test('returns CodexClient for codex type', () => {
      const client = getAssistantClient('codex');

      expect(client).toBeDefined();
      expect(client.getType()).toBe('codex');
      expect(typeof client.sendQuery).toBe('function');
    });

    test('returns CopilotClient for copilot type', () => {
      const client = getAssistantClient('copilot');

      expect(client).toBeDefined();
      expect(client.getType()).toBe('copilot');
      expect(typeof client.sendQuery).toBe('function');
    });

    test('throws error for unknown type', () => {
      expect(() => getAssistantClient('unknown')).toThrow(
        "Unknown assistant type: unknown. Supported types: 'claude', 'codex', 'copilot'"
      );
    });

    test('throws error for empty string', () => {
      expect(() => getAssistantClient('')).toThrow(
        "Unknown assistant type: . Supported types: 'claude', 'codex', 'copilot'"
      );
    });

    test('is case sensitive - Claude throws', () => {
      expect(() => getAssistantClient('Claude')).toThrow(
        "Unknown assistant type: Claude. Supported types: 'claude', 'codex', 'copilot'"
      );
    });

    test('each call returns new instance', () => {
      const client1 = getAssistantClient('claude');
      const client2 = getAssistantClient('claude');

      // Each call should return a new instance
      expect(client1).not.toBe(client2);
    });
  });
});
