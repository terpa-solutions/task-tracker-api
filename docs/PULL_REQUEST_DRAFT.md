# Pull request draft

Proposed title: **Add validated task fields, combined filters, and atomic bulk completion**

Status: **reviewed description ready for publication**. The user has authorized
signed commits and a cross-fork PR. The local technical verification remains
separate from fork setup, signing, push, and PR creation, whose results are
tracked in [WORK_PLAN.md](../WORK_PLAN.md).

## Problem and resulting behavior

The starter API cannot assign priorities or due dates, filter a task list, or
complete selected tasks together. This change adds those operations with strict
validation and an explicit, backed-up schema update for existing databases.

A task can be created with high priority and a due date, selected through
`GET /tasks?completed=false&priority=low,high`, and completed in a batch.
An invalid PATCH changes nothing. A batch containing missing IDs changes nothing;
repeating a successful batch returns `updated: 0` because it counts actual changes.

## Implementation and rationale

| Change | Why and how |
| --- | --- |
| Priority and due date | Validate the exact catalog and agreed date notation before writing. Default omitted creation fields to `medium` and SQL `NULL`; return the persisted task. PATCH preserves omitted fields and removes the date with `null` or the exact empty string. |
| Combined filters | Parameterized SQL applies OR within each comma-separated selection and AND across filters. Reject the entire malformed query, including unknown or repeated parameters, to prevent silently different selections. |
| Atomic bulk completion | Validate 1–500 unique IDs and use one immediate transaction for existence checks and updates. `jsonc-parser` preserves original numeric spelling and repeated property information that JSON.parse loses; Zod applies the agreed rules. |
| Preservation and bounded IDs | Enforce public numeric IDs 1–500000 without rounding. Creation checks existing IDs and AUTOINCREMENT inside the transaction; capacity failure leaves rows and sequence unchanged. |
| Explicit schema update | Back up committed SQLite data, add missing columns in the same database, verify original task values/metadata and sequence, and roll back on error. Reject incompatible schemas instead of silently repairing them. Seed only a newly created task table. |
| Clear error boundaries | Preserve English validation responses. Recognize Express route-decoding failures as 400, while retaining generic 500 responses and private server diagnostics for internal failures, including internal SyntaxError and URIError. |
| Narrow dependency correction | Keep Express 4.22.2, Node >=20, and better-sqlite3 11.10.0; update only body-parser to 1.20.8 and qs to 6.16.0 through a qs override scoped under Express. |

Routes map requests to controllers; controllers validate and translate results;
models own SQLite queries and transactions. Explicit connection/model/application
factories support temporary databases without opening SQLite during imports.
All project source and tests remain `.ts`. Shared validation helpers and an
injected date clock prevent divergent error handling and time-dependent tests,
without adding an injection framework or an extra service layer.

The final route correction returns
`{"error":"Invalid URL encoding. Use a valid percent-encoded task ID."}` for
PATCH/DELETE `/tasks/%` and `/tasks/%E0%A4%A`. Tests assert status, body, no model
calls, and unchanged SQLite data; the internal SyntaxError regression is retained.
The separate `typecheck` command also checks tests rather than only emitted
application source. Detailed contracts and motivations remain in
[HTTP_CONTRACT.md](HTTP_CONTRACT.md), [BUSINESS_RULES.txt](../BUSINESS_RULES.txt),
and [TECHNICAL_DECISIONS.md](TECHNICAL_DECISIONS.md).

## Explicit differences from the original exercise

These decisions came from the user during implementation. They are disclosed
for review and do **not** imply upstream reviewer or evaluator approval.

| Original requirement or starter behavior | Agreed implementation and consequence |
| --- | --- |
| `due_date`: "optional ISO date string" | Exact `YYYY-MM-DD HH:mm:ss`, with a space, whole seconds, and no timezone. It is not an arbitrary ISO 8601/RFC 3339 parser. Explicit dates use the API host's local day; `created_at` still uses SQLite's original generation. |
| GET returns an array | Uniform `{tasks, message}` object, including an English no-match message. Existing callers must read `response.tasks`. |
| No domain ID ceiling | IDs stop at 500000, including previously allocated IDs retained in the sequence. Exhaustion returns 400; deletion does not reclaim an identifier. |
| Single-value filter examples | Individual and comma-separated selections are supported, with strict validation. |
| Bulk semantics unspecified | Count only pending-to-completed transitions; any missing ID returns 404 with no partial update. |
| Seed when the table is empty | Seed only when initialization creates the table, preserving deliberate deletion and its sequence. |
| Ticket requests editing README | The user subsequently requested preserving the original README. Current usage and contracts are supplied separately; this does not claim literal completion of the README-edit requirement. |

Raising the minimum to Node 22 and upgrading the SQLite driver was considered
but not adopted, to respect the original runtime requirement. The delivered
combination is verified specifically with Node 20.20.2.

## Verification

Use Node **20.20.2** and its npm for both native dependency installation and
execution. From the repository root:

```text
node --version
npm ci
npm run test:db
npm run build
npm run typecheck
npm audit --json
```

`test:db` covers migrations, startup, validation, errors, and HTTP/SQLite behavior
using independent temporary databases. `build` compiles application source;
`typecheck` checks source and tests with no emit. There is no `npm test` alias.

[LOCAL_VERIFICATION.md](LOCAL_VERIFICATION.md) records the final installed
versions, exact test/audit results, example rerun, integrated create/filter/update/
clear-date/bulk/repeated-bulk/delete sequence, atomic missing-ID rejection, and
working-database preservation. The final checks passed **97 tests** with no
failures, skips, or cancellations, the build, source-and-test type checking,
and an audit reporting **zero vulnerabilities**. The installed application
also passed 19 curl example requests and 29 integrated HTTP requests.
The report distinguishes final results from the earlier
isolated dependency candidate. [DEPENDENCY_REVIEW.md](DEPENDENCY_REVIEW.md)
explains advisory exposure, the two-package scope, and the override removal rule.

For manual requests, use [API_EXAMPLES.md](API_EXAMPLES.md) on disposable data.
A fresh database initializes automatically. An existing starter database needs
the server stopped and `npm run db:update` executed before restart; inspect the
backup and report. Write examples are not checks to run against valuable data.

## Limits and proportionate future improvements

Migration comparison covers `tasks` and its sequence, not every database object.
The schema analyzer recognizes documented declaration forms; it does not prove
arbitrary SQL equivalent. Zero audit findings describe the recorded check, not
a general security guarantee. The scoped qs override must be reconsidered when
the selected Express version permits patched qs without it.

| Measured need or deployment change | Separate follow-up proposal |
| --- | --- |
| Larger lists or slow responses | Add bounded cursor pagination with an explicitly reviewed response contract. |
| Expensive filtered reads | Inspect representative query plans before adding indexes; low-cardinality fields do not justify every possible index. |
| Write contention or event-loop delay | Measure first, then evaluate a database worker or server database against operational cost. |
| Shared deployment or operational data | Define authentication/ownership, rate limits, monitoring, backup retention, and restore drills in a separate scope. |
| Runtime or dependency requirements change | Verify the new runtime/native-driver combination and regressions before changing the minimum. |

These are proposals, not implemented features or new conditions for this ticket.

## Publication execution checklist

- [x] Review this description and the complete deliverable file set, including compatibility differences and exclusion of local data, runtimes, and logs.
- [ ] Prepare the fork, remotes, delivery branch, and commit-signing identity under the user's publication instruction.
- [ ] Exclude working databases, backups, portable runtimes, and local logs; create and verify signed commits.
- [ ] Publish the approved branch and open the PR against `terpa-solutions/task-tracker-api:main`.
