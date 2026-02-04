---
name: manage-versions
description: Manage version control for modifications. Use when user wants to create branches, rollback, or experiment safely.
---

# Version Management

## Safe Experimentation

1. version_create_branch for new experiments
2. Make changes on the branch
3. Test thoroughly
4. version_merge if successful, or switch back to main

## Quick Rollback

1. version_history to see recent commits
2. version_rollback to restore previous state

## Version Control Tools

### Status
- `version_status` - Check current state (branch, HEAD, uncommitted changes)

### Branches
- `version_list_branches` - See all branches
- `version_create_branch` - Create new experiment branch
- `version_switch_branch` - Change to different branch

### History
- `version_history` - List recent commits
- `version_rollback` - Restore to a specific commit

### Merging
- `version_merge` - Merge a branch into current

## Workflow Examples

### Risky Change
```
1. version_create_branch("experiment-feature")
2. Make changes
3. Test
4. If good: version_merge("experiment-feature")
5. If bad: version_switch_branch("main")
```

### Quick Fix
```
1. Make fix directly on main
2. Changes auto-commit
3. If broken: version_rollback to previous commit
```

### Compare Changes
```
1. version_history to find commit SHAs
2. version_diff(from, to) to see what changed
```
