---
name: create-skill
description: Write a new skill for this app, so a workflow you just worked out is available next time. Use when the user asks for a skill, or when you have found a repeatable procedure worth keeping.
---

# Writing a Skill

A skill is a folder with a `SKILL.md` in it. Write one when you have worked out how to
do something in *this* app that you would otherwise work out again from scratch.

## Where It Goes

```
skills/<name>/SKILL.md
```

In the app root — the same place as `package.json`. That is inside the directory you
can write to, and it is committed with the app, so the skill is versioned alongside the
code it describes.

Do not try to write to `~/.keylimepi/skills`. That is the user's own library, shared by
every app, and it is outside your reach.

## The File

```markdown
---
name: add-endpoint
description: Add a REST endpoint to this app's Hono server, wired to a handler and a type. Use when adding a new route.
---

# Add an Endpoint

...the steps...
```

Two frontmatter fields, both required:

- **`name`** — lowercase letters, numbers and hyphens. It must match the folder name.
- **`description`** — **one line.** A second line is silently discarded.

## The Description Is the Whole Trigger

It is the only part of a skill anyone sees before deciding to open it — it sits in
every request, and it is what a later session matches the task against. The body costs
nothing until it is loaded.

So write the description as *when to use this*, not *what this is*:

- Good: "Add a pony behavior, building, or shop item. Use when extending the reducer or
  gameData."
- Bad: "Game system helper."

Name the concrete things a request would mention — files, features, the words the user
would actually say.

## The Body

- **Be specific to this app.** Real paths, real function names, real commands read from
  `package.json`. A skill that could apply to any project is not worth loading.
- **Write the steps in order**, the way you just did them.
- **Say what not to do**, if you hit something that did not work. That is the part
  worth keeping.
- **Keep it under a couple of hundred lines.** It is read into a small context window.

## After Writing It

Say the name out loud to the user — a skill nobody knows exists is not much use. It is
available immediately; call `load_skill` with its name when the task comes round again.
