---
name: manage-versions
description: Branch, inspect history, and roll back the app's git repository. Use before a risky change, or when something you did needs undoing.
---

# Version Management

Every `write`, `edit` and `replace_lines` you make is committed automatically. You do
not commit anything yourself — there is no commit tool, and there does not need to be.
What these tools give you is the ability to *move* through that history.

## The Tools

| Tool | What it does |
|------|--------------|
| `git_status` | Current branch, HEAD, and any uncommitted changes |
| `get_history` | Recent commits, newest first. Takes an optional `count` |
| `rollback` | Restore the app to a commit. Takes a `commit` SHA |
| `create_branch` | Create a branch and switch to it. Takes a `name` |
| `switch_branch` | Switch to an existing branch. Takes a `name` |
| `list_branches` | Every branch; the current one is marked `*` |

There is **no merge tool and no diff tool**. If a branch worked out, the user merges it
from the Version Control panel — say so rather than trying to do it yourself.

On a small context window the four branch tools are left out of the session to save
room. If you do not see them, work on the current branch and rely on `rollback`.

## Undoing Something

1. `get_history` to find the commit before the change went wrong.
2. `rollback` with that SHA.

Read the history before you roll back. The auto-commit message names the tool and the
file, so the commit you want is usually recognisable by its message alone.

## Trying Something Risky

1. `create_branch` with a name that says what you are trying.
2. Make the changes. They commit to that branch as you go.
3. Verify them.
4. Tell the user the branch name, and whether it worked.

If it did not work, `switch_branch` back and leave the branch behind — it costs nothing
and it is the evidence of what you tried.

## Before a Rollback

Rolling back discards work. Say what you are about to undo and why, in one line, before
you call `rollback`. The user is watching the transcript, and a rollback they did not
expect is worse than the bug it fixed.
