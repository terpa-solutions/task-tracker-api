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

- **Node.js**: `package.json` declares `>=20`; the recorded delivery was verified
  with **20.20.2** and **npm 10.8.2**.
- **npm** (ships with Node).

`better-sqlite3` is a native dependency. A native abort was reproduced with the
locked driver on Node 24.20.0; compatibility with every version satisfying
`>=20` is not established. See the [runtime decision](docs/TECHNICAL_DECISIONS.md#adopted-environment-and-dependencies).

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

Run these commands from the repository root:

```bash
npm ci
npm run dev
```

The API listens at **http://localhost:3000**. On startup it creates `data/tasks.db`
if needed, enables WAL and foreign keys, and checks the task schema and ID range.
It inserts four sample tasks **only when it creates the `tasks` table**. An existing
empty table stays empty, and restarting does not reset the AUTOINCREMENT sequence.

### Existing databases

Startup does not automatically migrate an existing task table. If you have the
starter database, stop the server, update it explicitly, then restart:

```bash
npm run db:update
npm run dev
```

The update creates a uniquely named SQLite backup under `data/backups/`, then
adds missing `priority` and `due_date` columns in a transaction. Existing tasks
receive `medium` and `null` for those new columns. It checks original task values,
column metadata, and sequence preservation; incompatible schemas are rejected.
See [migration scope and limits](docs/TECHNICAL_DECISIONS.md#transactions-seeding-and-preservation).

### Available scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start in watch mode with `tsx`. |
| `npm start` | Start once with `tsx`. |
| `npm run build` | Type-check application source and compile to `dist/`. |
| `npm run typecheck` | Type-check application source and tests without emitting files. |
| `npm run test:db` | Run the database, HTTP, error-handler, and validation tests. |
| `npm run db:update` | Back up and explicitly update an existing database. |

### Verification

```bash
npm run test:db
npm run build
npm run typecheck
```

The [recorded verification](docs/LOCAL_VERIFICATION.md) reports 97 passing tests
on Node 20.20.2, including combined filters, atomic bulk completion, validation,
and database preservation. That report describes its recorded revision and
environment; use the commands above to check your own checkout.

## Implemented API

Requests with a body use `Content-Type: application/json`. Task responses contain
`id`, `title`, `completed`, `created_at`, `priority`, and `due_date`.

| Method | Path | Success |
| --- | --- | --- |
| `GET` | `/health` | `200`, `{"status":"ok"}`. |
| `GET` | `/tasks` | `200`, `{"tasks":[...],"message":null}`; supports `completed` and `priority` filters. |
| `POST` | `/tasks` | `201`, created task; accepts `title`, optional `priority` and `due_date`. |
| `PATCH` | `/tasks/:id` | `200`, updated task; accepts one or more of `title`, `completed`, `priority`, `due_date`. |
| `DELETE` | `/tasks/:id` | `204`, empty body. |
| `POST` | `/tasks/bulk-complete` | `200`, `{"updated":n}` for the number of tasks changed from pending to completed. |

### Validation and behavior

- `title` is a nonempty string after trimming. `priority` is exactly `low`,
  `medium`, or `high`; omission on creation defaults to `medium`. New tasks start
  with `completed: false`. Unknown body properties are rejected.
- `due_date` uses **`YYYY-MM-DD HH:mm:ss`**, with a space and no time zone.
  The calendar day must be today or later according to the API host's local date;
  any valid time today is allowed. ISO strings with `T`, `Z`, or offsets are rejected.
- On creation, an omitted, `null`, empty, or ASCII-space-only date becomes `null`.
  On PATCH, omission preserves the stored date, while `null` or `""` clears it;
  a spaces-only date is invalid. Other omitted PATCH fields are also preserved.
- Filters accept comma-separated selections, such as `priority=low,high`.
  Selections within one filter use OR; different filters combine with AND.
  Unknown parameters, repeated keys or selections, spaces, and invalid values
  return `400`. Results are ordered by ID; no matches returns
  `{"tasks":[],"message":"No matching tasks found."}` with `200`.
- IDs range from **1 to 500000**. The creation limit includes the AUTOINCREMENT
  sequence: deleting tasks does not free previously allocated IDs.
- Bulk completion accepts **1–500 unique existing IDs**, written as decimal JSON
  integers. Strings, fractions, exponent notation, duplicates, and duplicate
  `ids` properties are rejected. If any task is missing, the whole batch returns
  `404` without changes. Repeating a successful batch returns `{"updated":0}`.

Invalid input returns `400`; missing tasks return `404`. Field validation uses
`{"errors":[{"field":"...","message":"..."}]}`, while route and operation errors
use `{"error":"..."}`. Invalid JSON returns `400`, oversized JSON bodies return
`413` (limit: 102400 bytes), and unsupported charset or content encoding returns
`415`. The [HTTP contract](docs/HTTP_CONTRACT.md) specifies the detailed rules.

### Curl examples

Run these examples in Bash or Git Bash. In the update, bulk, and delete examples,
replace `{id}` with the ID returned by the create request. Keep the task pending
until the bulk request to see `{"updated":1}`; repeating it returns `{"updated":0}`.
The sample due date must still be today or later when you run the request.

```bash
# Health and current tasks.
curl -i http://localhost:3000/health
curl -i http://localhost:3000/tasks

# Create a pending task with both new fields. Note the returned id.
curl -i -X POST http://localhost:3000/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Prepare report","priority":"high","due_date":"2099-12-31 18:00:00"}'

# Combine filters and select more than one priority.
curl -i 'http://localhost:3000/tasks?completed=false&priority=low,high'

# Update priority; keep all omitted fields.
curl -i -X PATCH 'http://localhost:3000/tasks/{id}' \
  -H 'Content-Type: application/json' \
  -d '{"priority":"low"}'

# Clear the due date.
curl -i -X PATCH 'http://localhost:3000/tasks/{id}' \
  -H 'Content-Type: application/json' \
  -d '{"due_date":null}'

# Complete the created task. Replace {id} with the unquoted numeric ID.
# A batch may include more existing IDs, for example: {"ids":[5,6]}.
curl -i -X POST http://localhost:3000/tasks/bulk-complete \
  -H 'Content-Type: application/json' \
  -d '{"ids":[{id}]}'

# Delete the task after testing the other operations.
curl -i -X DELETE 'http://localhost:3000/tasks/{id}'
```

For an invalid-input example, create with `{"title":"Prepare report","priority":"HIGH"}`:
expect `400`, a `priority` validation error, and no new task. More request examples
and their original verification are in [API_EXAMPLES.md](docs/API_EXAMPLES.md)
and [EXAMPLE_VERIFICATION.md](docs/EXAMPLE_VERIFICATION.md).

### Decisions beyond the original ticket

The original ticket below is retained verbatim. It asks for an optional ISO date
string; the implemented date format, host-local day validation, list response
envelope, multiple filter selections, and ID ceiling reflect later decisions
made during development. They are documented differences, not evidence of
acceptance by the interviewer. This README now describes the implemented API.

See [business rules](BUSINESS_RULES.txt), [technical decisions](docs/TECHNICAL_DECISIONS.md),
and the [historical decision record](docs/DECISION_HISTORY.txt) for their rationale.
Earlier verification and publication records describe the state before this
README update, including the earlier instruction to preserve the entire file.

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
