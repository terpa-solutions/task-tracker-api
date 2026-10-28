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
- adds any columns missing from a database created by an older version
  (e.g. `priority` and `due_date`), so an existing `data/tasks.db` keeps working,
- seeds a few sample tasks **only if** the table is empty.

Set `DB_PATH` to use a different database file, or `:memory:` for a throwaway one:

```bash
DB_PATH=:memory: npm start
```

### Available scripts

| Script          | What it does                                             |
| --------------- | -------------------------------------------------------- |
| `npm run dev`   | Start in watch mode with `tsx` (auto-reload).            |
| `npm start`     | Start once with `tsx` (no watch).                        |
| `npm run build` | Type-check and compile to `dist/` with `tsc`.            |
| `npm test`      | Run the test suite (Vitest + Supertest, in-memory DB).   |

### API

| Method   | Path                   | Description                                                  |
| -------- | ---------------------- | ------------------------------------------------------------ |
| `GET`    | `/health`              | Liveness check.                                              |
| `GET`    | `/tasks`               | List tasks, oldest first. Filter with `completed`/`priority`. |
| `POST`   | `/tasks`               | Create a task.                                               |
| `PATCH`  | `/tasks/:id`           | Update any of `title`, `completed`, `priority`, `due_date`.  |
| `DELETE` | `/tasks/:id`           | Delete a task.                                               |
| `POST`   | `/tasks/bulk-complete` | Mark several tasks as completed.                             |

#### Task shape

```json
{
  "id": 2,
  "title": "Review the interview ticket in the README",
  "completed": false,
  "priority": "high",
  "due_date": "2026-11-01T17:00:00.000Z",
  "created_at": "2026-10-28 15:57:23"
}
```

| Field      | Type                              | Notes                                                       |
| ---------- | --------------------------------- | ----------------------------------------------------------- |
| `title`    | string                            | Required on create; trimmed; must not be blank.             |
| `completed`| boolean                           | `false` on create.                                          |
| `priority` | `"low"` \| `"medium"` \| `"high"` | Defaults to `"medium"`.                                     |
| `due_date` | ISO 8601 string \| `null`         | Optional. See below.                                        |

`due_date` accepts a date (`2026-12-31`) or a datetime with an explicit offset
(`2026-12-31T17:00:00Z`, `2026-12-31T10:30:00-06:00`), and is always returned
normalized to UTC (`2026-12-31T16:30:00.000Z`). A date-only value means midnight
UTC. Datetimes without an offset are rejected because their meaning would depend
on the server's timezone, and so are impossible dates such as `2026-02-30`.

#### Filtering `GET /tasks`

| Query param | Values                    |
| ----------- | ------------------------- |
| `completed` | `true` \| `false`         |
| `priority`  | `low` \| `medium` \| `high` |

Filters can be combined and are applied together (AND). Any other value — such as
`completed=1` or a repeated param — returns `400`, and so does an unknown param, so
a typo like `?priorty=high` fails loudly instead of returning an unfiltered list.

#### `POST /tasks/bulk-complete`

Body: `{ "ids": number[] }` with 1 to 1000 positive integer ids. Responds `200` with:

```json
{ "updated": 2, "not_found": [999] }
```

- `updated` — tasks that went from open to completed. Tasks that were already
  completed are left as they are and not counted.
- `not_found` — requested ids with no matching task, in request order. The other
  ids are still completed, so one stale id doesn't block the rest.

A repeated id is counted once in either field.

#### Errors

Invalid input returns `400` with one entry per problem, so a client can fix every
field in one round trip:

```json
{
  "error": "Invalid request body.",
  "details": [
    { "path": "title", "message": "Must not be empty." },
    { "path": "priority", "message": "Must be one of: low, medium, high." }
  ]
}
```

Request bodies and the `GET /tasks` query are strict: unknown fields or params
(e.g. a typo like `"prio"`) are rejected rather than silently ignored.
Other errors use `{ "error": "..." }`: `404` for a missing task, `400` for malformed
JSON, `413` for a body over 100 kB.

### Verify it works

```bash
# Health check
curl http://localhost:3000/health

# List all tasks (returns the seeded sample data)
curl http://localhost:3000/tasks

# Filter: open tasks, high priority only (filters combine)
curl "http://localhost:3000/tasks?completed=false&priority=high"

# Create a task with a priority and a due date
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Write the pull request description","priority":"high","due_date":"2026-11-03T18:00:00Z"}'

# Update a task (any subset of title, completed, priority, due_date)
curl -X PATCH http://localhost:3000/tasks/1 \
  -H "Content-Type: application/json" \
  -d '{"priority":"low","due_date":"2026-12-31"}'

# Clear a due date
curl -X PATCH http://localhost:3000/tasks/1 \
  -H "Content-Type: application/json" \
  -d '{"due_date":null}'

# Complete several tasks at once -> {"updated":2,"not_found":[999]}
curl -X POST http://localhost:3000/tasks/bulk-complete \
  -H "Content-Type: application/json" \
  -d '{"ids":[2,3,999]}'

# Invalid input -> 400 with details
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"","priority":"urgent"}'

# Delete a task
curl -X DELETE http://localhost:3000/tasks/1
```

Run the automated tests:

```bash
npm test
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
