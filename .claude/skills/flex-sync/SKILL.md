---
name: flex-sync
description: |
  Sync the flex branch with upstream (coleam00/Archon).
  Fetches upstream/dev, fast-forwards develop, and merges into flex.

  TRIGGERS - Use this skill when user says:
  - "/flex-sync" - sync upstream into flex
  - "sync upstream", "pull upstream", "update from upstream"
  - "traer cambios de upstream", "sincronizar con upstream"
---

# Flex Sync Skill

Syncs the fork's `flex` branch with the upstream Archon repo.

Flow: `upstream/dev → develop → flex`

## Prerequisites

- Remote `upstream` points to `https://github.com/coleam00/Archon.git`
- Branch `develop` tracks `upstream/dev`
- Branch `flex` is the working branch

## Process

### Step 1: Validate State

```bash
# Verify remotes exist
git remote get-url upstream   # must be coleam00/Archon
git remote get-url origin     # must be FlexibilitySRL/archon-flx

# Must be on flex branch
git rev-parse --abbrev-ref HEAD  # must be "flex"
```

If not on `flex`, abort: "Switch to flex first: `git checkout flex`"

If `upstream` remote is missing, add it:
```bash
git remote add upstream https://github.com/coleam00/Archon.git
```

### Step 2: Check for Uncommitted Changes

```bash
git status --porcelain
```

If there are uncommitted changes, stash them:
```bash
git stash --include-untracked -m "flex-sync: auto-stash before upstream merge"
```

Remember that a stash was created so it can be restored at the end.

### Step 3: Fetch Upstream

```bash
git fetch upstream dev
```

Show how many new commits are available:
```bash
git rev-list --count develop..upstream/dev
```

If 0 new commits, report "Already up to date with upstream." and skip to Step 6 (restore stash if needed).

### Step 4: Fast-Forward develop

```bash
git checkout develop
git merge --ff-only upstream/dev
```

If fast-forward fails, it means someone committed directly to `develop`. This should NOT happen under the fork branching model. Abort with:
"ERROR: develop has diverged from upstream/dev. This branch should only receive upstream changes. Investigate before proceeding."

Push the updated develop to origin:
```bash
git push origin develop
```

### Step 5: Merge develop into flex

```bash
git checkout flex
git merge develop -m "merge: sync upstream (<N> commits from coleam00/Archon)"
```

Replace `<N>` with the actual count from Step 3.

**If there are merge conflicts:**
1. List the conflicted files
2. Show the user the conflicts with `git diff --name-only --diff-filter=U`
3. Do NOT auto-resolve. Ask the user how they want to handle each conflict.
4. After resolution, complete the merge commit.

**If merge is clean:**
Push the result:
```bash
git push origin flex
```

### Step 6: Restore Stash

If a stash was created in Step 2:
```bash
git stash pop
```

If stash pop has conflicts, inform the user and list affected files. Do NOT drop the stash — let the user resolve manually.

### Step 7: Report

Show a summary:
- Number of upstream commits merged
- Whether conflicts occurred (and resolution status)
- Whether a stash was restored
- Current branch and commit

## Important Rules

- NEVER force push any branch
- NEVER commit directly to `develop` — it is an upstream mirror
- NEVER auto-resolve merge conflicts — always ask the user
- NEVER drop a stash that failed to apply
- If `develop` has diverged from upstream, stop and investigate — do not rebase or force-merge
