# Task Tracker API

A small, self-contained REST API for tracking tasks, built with **Node.js + TypeScript**, **Express**, and **better-sqlite3** (a synchronous, file-based SQLite driver). It runs locally with zero external services — no Docker, no Postgres, no Redis.

---

## Why this repository exists

This repository is a **live coding interview exercise**. Its purpose is to evaluate a candidate's **agentic engineering skills** — how effectively you work *with* AI coding agents (Claude Code, Cursor, Codex, Claude.ai, ChatGPT, etc.), not how fast you type from memory.

You are **encouraged to use AI coding agents freely.** We are specifically looking at:

- **Problem framing & decomposition** — how you break a multi-step ticket into a clear plan.
- **Steering the agent** — the quality of your prompts and how you iterate when output isn't right.
- **Verification habits** — how carefully you check generated code *and* the resulting database state, rather than trusting output blindly.
- **Ownership of the deliverable** — whether you can ship a clean, reviewable pull request.

The starting code is intentionally simple. The interesting part is the **ticket** (below) and how you drive it to completion.

---

## Prerequisites

- **Node.js 20+** (developed and tested on Node 22)
- **npm** (ships with Node)

That's it. The SQLite database is a local file that is created and initialized automatically on first run.

---

## Contributor workflow (fork → sign → cross-fork PR)

Work on your **own fork** and open a pull request back to this repository:

1. **Fork** this repo to your personal GitHub account (top-right **Fork** button).
2. **Clone your fork** and add this repo as `upstream`:
   ```bash
   git clone git@github.com:<your-username>/task-tracker-api.git
   cd task-tracker-api
   git remote add upstream git@github.com:terpa-solutions/task-tracker-api.git
   ```
3. **Sign your commits** — this org **requires verified (signed) commits**. Set up signing once (see below) before you commit.
4. Do your work on a branch, push to your fork, then open a **cross-fork pull request** from `<your-username>:your-branch` → `terpa-solutions:main`.

### Commit signing (required)

The organization enforces signed commits on the default branch, so unsigned commits will be rejected. If you already sign commits, skip this. Otherwise, set up **GPG signing** with GitHub:

```bash
# 1. Generate a GPG key (choose RSA 4096; use the email tied to your GitHub account)
gpg --full-generate-key

# 2. Find the key's long ID
gpg --list-secret-keys --keyid-format=long
#   look for the line:  sec  rsa4096/<KEY_ID> ...

# 3. Print the public key and copy the whole block
gpg --armor --export <KEY_ID>
```

Then add it to GitHub: **Settings → SSH and GPG keys → New GPG key**, and paste the block.

Finally, tell git to sign with it:

```bash
git config --global user.signingkey <KEY_ID>
git config --global commit.gpgsign true
```

> macOS users: if signing fails with a TTY error, add `export GPG_TTY=$(tty)` to your shell profile.
>
> Prefer SSH signing? It's simpler if you already have an SSH key on GitHub — add the same public key as a **Signing Key**, then:
> `git config --global gpg.format ssh && git config --global user.signingkey ~/.ssh/id_ed25519.pub && git config --global commit.gpgsign true`

Verify a commit is signed with `git log --show-signature -1`, or check for the green **Verified** badge on GitHub.

## Installation & Running

```bash
npm install
npm run dev
```

The API will be available at **http://localhost:3000**.

On startup the app:
- creates the `data/` directory and `data/tasks.db` if they don't exist,
- applies `schema.sql` (idempotent — safe on every start),
- adds any columns missing from an older database file (also idempotent),
- seeds a few sample tasks **only if** the table is empty.

Set `DATABASE_PATH` to use a different file, or `:memory:` for a throwaway
database that disappears on exit. The test suite uses this.

### Verify it works

```bash
# Health check
curl http://localhost:3000/health

# List all tasks (returns the seeded sample data)
curl http://localhost:3000/tasks

# Fetch a single task
curl http://localhost:3000/tasks/1

# Filter: only pending tasks
curl 'http://localhost:3000/tasks?completed=false'

# Filter: only high-priority tasks
curl 'http://localhost:3000/tasks?priority=high'

# Filters combine (pending AND high priority)
curl 'http://localhost:3000/tasks?completed=false&priority=high'

# Create a task (priority defaults to "medium", due_date to null)
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Write the pull request description"}'

# Create a task with the optional fields
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Ship the ticket","priority":"high","due_date":"2026-09-30"}'

# Update a task (any subset of title, completed, priority, due_date)
curl -X PATCH http://localhost:3000/tasks/1 \
  -H "Content-Type: application/json" \
  -d '{"completed":true,"priority":"low"}'

# Clear a due date by setting it to null
curl -X PATCH http://localhost:3000/tasks/1 \
  -H "Content-Type: application/json" \
  -d '{"due_date":null}'

# Complete several tasks at once
curl -X POST http://localhost:3000/tasks/bulk-complete \
  -H "Content-Type: application/json" \
  -d '{"ids":[1,2,3]}'
# -> {"updated":2}   (ids that do not exist, or were already completed, are skipped)

# Delete a task
curl -X DELETE http://localhost:3000/tasks/1

# Invalid input returns 400 with the offending field
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Nope","priority":"urgent"}'
# -> {"error":"Invalid request.","details":["priority: Invalid option: expected one of \"low\"|\"medium\"|\"high\""]}
```

### Available scripts

| Script          | What it does                                  |
| --------------- | --------------------------------------------- |
| `npm run dev`   | Start in watch mode with `tsx` (auto-reload). |
| `npm start`     | Start once with `tsx` (no watch).             |
| `npm run build` | Type-check and compile to `dist/` with `tsc`. |
| `npm test`      | Run the test suite with Node's built-in runner. |

### Current API

| Method   | Path                   | Description                                                        |
| -------- | ---------------------- | ------------------------------------------------------------------ |
| `GET`    | `/health`              | Liveness check.                                                    |
| `GET`    | `/tasks`               | List tasks. Optional `?completed=true\|false` and `?priority=low\|medium\|high`, combinable. |
| `GET`    | `/tasks/:id`           | Fetch a single task.                                               |
| `POST`   | `/tasks`               | Create a task from `{ "title", "priority"?, "due_date"? }`.        |
| `POST`   | `/tasks/bulk-complete` | Mark `{ "ids": number[] }` as completed. Returns `{ "updated": n }`. |
| `PATCH`  | `/tasks/:id`           | Update any subset of `title`, `completed`, `priority`, `due_date`.  |
| `DELETE` | `/tasks/:id`           | Delete a task.                                                     |

#### Task fields

| Field        | Type                          | Notes                                                      |
| ------------ | ----------------------------- | ---------------------------------------------------------- |
| `id`         | number                        | Assigned by the database.                                  |
| `title`      | string                        | Required, non-empty; surrounding whitespace is trimmed.    |
| `completed`  | boolean                       | Defaults to `false`.                                       |
| `created_at` | string                        | Set by the database, returned as UTC ISO-8601 (`2026-09-30T12:00:00Z`). |
| `priority`   | `"low" \| "medium" \| "high"` | Defaults to `"medium"`.                                    |
| `due_date`   | string \| null                | `YYYY-MM-DD`, validated against the calendar. Optional; send `null` to clear it. |

Invalid input returns `400` as `{ "error": "Invalid request.", "details": [...] }`,
where each entry names the field that failed.

`bulk-complete` counts only tasks that actually changed: ids that do not exist,
and tasks that were already completed, are skipped and not included in `updated`.

---

## The Interview Challenge (the ticket)

Complete the steps below **in order**. You are encouraged to use any AI coding agent (Claude Code, Cursor, Codex, etc.).

> ### Ticket — Evolve the Task Tracker
>
> Please make the following changes.
>
> **1. Add two new fields to tasks:**
> - `priority`: `'low' | 'medium' | 'high'` (default `'medium'`)
> - `due_date`: optional ISO date string
>
> Update the schema, types, and all existing endpoints accordingly.
>
> **2. Extend `GET /tasks` so it supports filtering:**
> - `?completed=true` or `?completed=false`
> - `?priority=low|medium|high`
>
> Filters can be combined.
>
> **3. Add a new endpoint `POST /tasks/bulk-complete`** that accepts `{ "ids": number[] }` and marks all those tasks as completed. Return how many were updated.
>
> **4. Add proper input validation** (Zod is recommended) for the create, update, and bulk-complete endpoints. Return clear `400` responses on invalid input.
>
> **5. Add at least two automated tests** covering the new filtering behavior and the bulk-complete endpoint.
>
> **6. Update this README** with the new endpoints and example curl commands.

### Final step

When you are finished, **open a cross-fork pull request from your fork against this repo's `main` branch** (`<your-username>:your-branch` → `terpa-solutions:main`). Make sure every commit is **signed/verified**. The PR description must clearly explain:

- **What was changed**
- **How to verify the changes** (including any new endpoints and test commands)
- **Any trade-offs or decisions you made**

---

## Evaluation criteria

Interviewers are looking for:

- **Problem framing** — a clear plan that decomposes the ticket into ordered, verifiable steps.
- **Prompt quality** — effective, specific instructions to the AI agent, and good iteration when the first output falls short.
- **Verification habits** — checking both the code and the actual database/API behavior (not just trusting generated code).
- **Code quality** — clean types, sensible error handling, correct HTTP status codes, no dead TODOs.
- **Testing** — meaningful tests that actually exercise the new behavior.
- **Ownership of the final PR** — a clear, honest description covering what changed, how to verify, and trade-offs.
