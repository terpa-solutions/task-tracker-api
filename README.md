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

- **Node.js 20+** to run the API; the test suite (Vitest 5) needs **Node 22.12+ or 24+** (Node 22 recommended; tested on Node 24; the project uses `better-sqlite3` ^12)
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
- migrates older databases: the migration is additive and idempotent — it adds the `priority` and `due_date` columns to an existing `tasks` table when they are missing and is a no-op otherwise (there is no schema version table),
- seeds a few sample tasks **only if** the table is empty.

### Configuration

| Variable  | Default        | Description                                                                                                   |
| --------- | -------------- | ------------------------------------------------------------------------------------------------------------- |
| `PORT`    | `3000`         | HTTP port.                                                                                                    |
| `DB_PATH` | `data/tasks.db` | SQLite file to use (relative paths resolve against the current directory). `:memory:` opens an ephemeral in-memory database. Empty = default path. |

```bash
# Run against a throwaway database on another port
DB_PATH=./data/tmp.db PORT=3001 npm run dev
```

### Verify it works

The examples below assume a fresh database (the 4 seeded tasks, ids 1–4) and are meant to be run in order.

```bash
# Health check
curl http://localhost:3000/health
# -> 200 {"status":"ok"}

# List all tasks (returns the seeded sample data)
curl http://localhost:3000/tasks

# Create a task (priority and due_date are optional)
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Write the pull request description","priority":"high","due_date":"2026-11-15"}'
# -> 201 {"id":5,"title":"Write the pull request description","completed":false,"created_at":"2026-10-23 23:03:05","priority":"high","due_date":"2026-11-15"}

# Update a task's priority and due date
curl -X PATCH http://localhost:3000/tasks/5 \
  -H "Content-Type: application/json" \
  -d '{"priority":"low","due_date":"2026-11-30"}'
# -> 200 {"id":5,...,"priority":"low","due_date":"2026-11-30"}

# Clear the due date
curl -X PATCH http://localhost:3000/tasks/5 \
  -H "Content-Type: application/json" \
  -d '{"due_date":null}'
# -> 200 {"id":5,...,"priority":"low","due_date":null}

# Mark a task as completed
curl -X PATCH http://localhost:3000/tasks/1 \
  -H "Content-Type: application/json" \
  -d '{"completed":true}'

# Filter: pending high-priority tasks (quote the URL so the shell doesn't interpret "&")
curl "http://localhost:3000/tasks?completed=false&priority=high"
# -> 200 [{"id":4,"title":"Open a pull request with the completed work","completed":false,...,"priority":"high","due_date":"2026-12-31"}]

# Bulk-complete: duplicates are deduped, unknown ids (999) are ignored
curl -X POST http://localhost:3000/tasks/bulk-complete \
  -H "Content-Type: application/json" \
  -d '{"ids":[2,3,3,999]}'
# -> 200 {"updated":2}
# Repeating the same request -> 200 {"updated":0} (those tasks are already completed)

# Invalid input -> 400 with details
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"","priority":"urgent","due_date":"2026-11-15T10:00:00Z"}'
# -> 400 (see "Errors" below for the full body)

# Delete a task
curl -X DELETE http://localhost:3000/tasks/5
# -> 204 (no body)
```

> **PowerShell:** the examples above are for bash (Git Bash, macOS, Linux). In PowerShell use `curl.exe` (in Windows PowerShell 5.1 plain `curl` is an alias of `Invoke-WebRequest`), and note that PowerShell mangles the inner double quotes of `-d '{"title":...}'`. Piping the JSON body through stdin avoids the quoting issue:
> `'{"title":"Hello","priority":"high"}' | curl.exe -X POST http://localhost:3000/tasks -H "Content-Type: application/json" --data-binary "@-"`

### Available scripts

| Script               | What it does                                    |
| -------------------- | ----------------------------------------------- |
| `npm run dev`        | Start in watch mode with `tsx` (auto-reload).   |
| `npm start`          | Start once with `tsx` (no watch).               |
| `npm run build`      | Type-check and compile to `dist/` with `tsc`.   |
| `npm test`           | Run the test suite once (Vitest + Supertest).   |
| `npm run test:watch` | Run the tests in watch mode.                    |

The tests run against an in-memory database (`DB_PATH=:memory:`, set in `vitest.config.ts`) and never touch `data/`.

### Task model

| Field        | Type                          | Notes                                                                                     |
| ------------ | ----------------------------- | ----------------------------------------------------------------------------------------- |
| `id`         | integer                       | Assigned by the database.                                                                 |
| `title`      | string                        | Required, non-empty (surrounding whitespace is trimmed).                                  |
| `completed`  | boolean                       | Defaults to `false`.                                                                      |
| `created_at` | string                        | Set by the database (`YYYY-MM-DD HH:MM:SS`, UTC).                                         |
| `priority`   | `"low" \| "medium" \| "high"` | Defaults to `"medium"`.                                                                   |
| `due_date`   | string \| `null`              | Calendar date `YYYY-MM-DD`, or `null`. A full ISO date-time (e.g. `2026-11-15T10:00:00Z`) is rejected with `400`. |

### API

| Method   | Path                   | Description |
| -------- | ---------------------- | ----------- |
| `GET`    | `/health`              | Liveness check. |
| `GET`    | `/tasks`               | List tasks (oldest first). Optional filters `?completed=true\|false` and `?priority=low\|medium\|high`, combinable (AND). Values are strict and case-sensitive (`?priority=HIGH` → `400`); unknown query params are ignored. |
| `POST`   | `/tasks`               | Create a task from `{ "title": "...", "priority"?: "...", "due_date"?: "YYYY-MM-DD" \| null }`. `201` with the task. |
| `PATCH`  | `/tasks/:id`           | Update at least one of `title`, `completed`, `priority`, `due_date`. `"due_date": null` clears the date. `200` with the task. |
| `DELETE` | `/tasks/:id`           | Delete a task. `204`. |
| `POST`   | `/tasks/bulk-complete` | Mark tasks as completed from `{ "ids": [...] }`: 1 to 500 positive integer ids; duplicates are deduped; unknown ids are ignored. `200 { "updated": n }`, where `n` is how many tasks went from pending to completed (repeating the same request returns `0`). |

### Errors

All errors are JSON. Validation errors (`400`) include the first problem as `error` plus every problem in `details` (`field` is `null` for body-level errors):

```json
{ "error": "...", "details": [{ "field": "...", "message": "..." }] }
```

Other errors only carry `{ "error": "..." }`: invalid task id (`400`), task or route not found (`404`), malformed JSON body (`400`), body too large (`413`), other body-parsing errors such as an unsupported charset (`415`/`4xx`), and unexpected server errors (`500`).

Real response for the invalid `POST /tasks` example above:

```json
{
  "error": "Field \"title\" is required and must be a non-empty string.",
  "details": [
    { "field": "title", "message": "Field \"title\" is required and must be a non-empty string." },
    { "field": "priority", "message": "Field \"priority\" must be one of: low, medium, high." },
    { "field": "due_date", "message": "Field \"due_date\" must be a valid date in YYYY-MM-DD format or null." }
  ]
}
```

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
