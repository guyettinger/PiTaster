---
paths:
  - "docs/**/*.md"
---

# Documentation Practices

## Location and Naming

- All project documentation (`*.md`) goes in `docs/`
- Use `SCREAMING_SNAKE_CASE.md` for feature docs (e.g. `SELF_MODIFICATION_SYSTEM.md`)
- Exceptions that stay at the repository root: `README.md`, `AGENTS.md`, `CLAUDE.md`, `LICENSE`
- `docs/plans/` holds one document per implementation session, plus a `-NOTES.md`
  counterpart written after the work lands. `docs/plans/README.md` indexes them.

## When to Create Documentation

Create documentation for:

- New features with non-obvious behavior
- Complex workflows spanning multiple files
- Architecture decisions that affect multiple areas
- Learnings that are non-obvious or surprising (what worked, what didn't, why)
- Integration guides for external services (MCP servers, APIs)

## Structure

```markdown
# Feature Name

## Overview
Brief description of what this feature does.

## Architecture
How the feature is structured across the codebase.

## Usage
How to use the feature with examples.

## Configuration
Any settings or environment variables.

## Troubleshooting
Common issues and solutions.
```

## Code Examples

- Include working code examples
- Use language-specific code blocks
- Keep examples minimal but complete
- Update examples when the code changes

## Don't Document

- Obvious behavior already clear from the code
- Implementation details that change frequently
- Information already covered by TSDoc comments
