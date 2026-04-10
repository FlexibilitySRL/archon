# Flex Fork Governance

This repo is a fork of the archon open-source project maintained by FlexibilitySRL.
Fork purpose: extend archon with Flex-specific integrations, workflows, and customizations.

## Upstream Boundary — Never Touch

These files and directories belong to upstream. Do NOT modify them:

- `CLAUDE.md` (root)
- `.claude/rules/*.md` — all existing rules files
- `.claude/agents/`, `.claude/commands/`, `.claude/docs/`, `.claude/skills/` — existing upstream entries
- All source files under `packages/` unless adding a new `flex-*` module or implementing a new adapter/client

When upstream changes conflict with Flex additions, the Flex addition adapts — not the upstream file.

## Extension Pattern

**Add-only. Never modify upstream files.**

- New rules → `.claude/rules/flex-*.md`
- New workflows → `.archon/workflows/flex-*.yaml`
- New commands → `.archon/commands/flex-*.md`
- New scripts → `.archon/scripts/flex-*.ts`
- New packages → `packages/flex-*/` (follow existing package structure)
- New adapter → `packages/adapters/src/flex/<name>/` implementing `IPlatformAdapter`

Prefix `flex-` on all fork-owned additions to avoid naming collisions on upstream merges.

## Upstream Sync

When pulling from upstream (`git merge upstream/main` or rebase):

1. Conflicts in `CLAUDE.md` or `.claude/rules/` → always take upstream version
2. Conflicts in `packages/` source → evaluate case by case, prefer upstream behavior, adapt Flex additions
3. After merge: run `bun run validate` before committing

## What Lives Here vs Upstream

| Concern | Owner | Location |
|---|---|---|
| Core architecture, engine, adapters | Upstream | `packages/` |
| Flex-specific workflows | Flex | `.archon/workflows/flex-*.yaml` |
| Flex platform integrations | Flex | `packages/adapters/src/flex/` |
| Fork governance rules | Flex | `.claude/rules/flex-*.md` |
| Local secrets / env | Never committed | `.env` |
