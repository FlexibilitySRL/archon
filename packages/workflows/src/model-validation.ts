export function isClaudeModel(model: string): boolean {
  return (
    model === 'sonnet' ||
    model === 'opus' ||
    model === 'haiku' ||
    model === 'inherit' ||
    model.startsWith('claude-')
  );
}

export function isModelCompatible(
  provider: 'claude' | 'codex' | 'copilot',
  model?: string
): boolean {
  if (!model) return true;
  if (provider === 'claude') return isClaudeModel(model);
  // Copilot and Codex: accept any model string, reject obvious Claude aliases
  return !isClaudeModel(model);
}
