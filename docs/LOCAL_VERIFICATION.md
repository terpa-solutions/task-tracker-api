# Local technical verification

Verified on **2026-09-09** with **Node 20.20.2** and **npm 10.8.2**.
This report covers the completed local technical closure. During that phase,
no Git commands, GitHub queries, signed commits, branch publication, or PR
creation were performed. The user subsequently authorized publication;
the reviewed [PR description](PULL_REQUEST_DRAFT.md) and
[work plan](../WORK_PLAN.md) track that separate phase.

## Final changes and reasons

- Recognize Express 4's route-decoding signature: `URIError`, both status
  properties equal to 400, and its `Failed to decode param '…'` message.
  PATCH and DELETE with `/tasks/%` or `/tasks/%E0%A4%A` return
  `{"error":"Invalid URL encoding. Use a valid percent-encoded task ID."}`.
  Generic internal errors retain 500; the existing internal SyntaxError test
  remains unchanged, and three internal URIError cases guard that distinction.
- Apply the approved dependency correction: body-parser **1.20.8** and qs
  **6.16.0**, with the qs override scoped under Express. Express stays **4.22.2**,
  better-sqlite3 **11.10.0**, and the Node requirement **>=20**. Comparing the
  before/after lockfiles identified exactly two changed package entries.
- Add `npm run typecheck` with [tsconfig.tests.json](../tsconfig.tests.json)
  to check both application source and tests, without emitting files. The
  original application build configuration remains unchanged.
- Align the English rules, contracts, dependency status, work plan, and local
  PR draft. Correct only the historical archive's header; preserve its payload
  and the original README. The agreed date, list-response, and ID differences
  remain explicit and are not attributed to evaluator approval.

The complete dependency rationale and override removal condition are in
[DEPENDENCY_REVIEW.md](DEPENDENCY_REVIEW.md). HTTP details are in
[HTTP_CONTRACT.md](HTTP_CONTRACT.md).

## Commands and exact results

| Check | Result |
| --- | --- |
| `npm ci --no-fund --no-audit` | Exit 0; installed the approved lockfile, including the native SQLite driver. Audit was run separately below. |
| `npm run test:db` | Exit 0; **97 tests, 97 passed, 0 failed, 0 skipped, 0 cancelled, 0 todo**; 28,144.2934 ms. |
| `npm run build` | Exit 0; application compilation succeeded. |
| `npm run typecheck` | Exit 0; strict source-and-test checking succeeded, using `src/**/*.ts` and `tests/**/*.ts`, with no emit. |
| `npm audit --json` | Exit 0; **0 vulnerabilities** in every reported severity category. |
| Installed dependency tree | Express 4.22.2, body-parser 1.20.8, one shared qs 6.16.0, better-sqlite3 11.10.0; no invalid tree. |

The targeted error-handler run passed 9 tests; those same tests are included
in the 97-test suite, not an additional 9 tests. Four cases assert the malformed
route's exact status/body, zero calls to all six model methods, and unchanged
SQLite rows, schema, and sequence. Three URIError counterexamples remain 500;
the prior SyntaxError and headers-already-sent tests also pass.

## Isolation and integrated behavior

The full suite ran in a short independent copy at `C:\tt-check\run-dRExpm`
to avoid nested Windows path limits. Its 29 source, test, manifest, schema,
and configuration inputs matched the working project by SHA-256 before and
after the run. Installed dependencies were copied from the approved clean
installation. The working `data/` directory was not copied. Test fixtures,
including real startup and migration processes, remained inside that copy.
The per-test database files were removed. The verified project copy itself is
retained locally: automatic command review rejected its recursive deletion with
the reason `blocked by policy`. No alternative deletion was attempted.

The additional integrated verification used two independent SQLite files under
short `C:\tt-check\http-*` paths and ephemeral localhost ports. It passed
**29 HTTP requests and 98 recorded assertions**, covering:

- Creation with explicit priority/date and with omitted date; full responses
  matched the stored SQLite rows.
- The six agreed filter examples, compared with independently selected SQLite
  rows; invalid and empty-result queries retained their contracts.
- PATCH preserving omitted fields; both empty-string and null date removal.
- Bulk completion returning one real transition, then zero on repetition.
- A batch mixing an existing pending task with a nonexistent ID returning 404,
  preserving every row and the sequence without a partial update.
- Deletion, repeated deletion, all four malformed route cases, and continued
  isolation of the second database. Invalid routes made zero model calls.

The published curl blocks were rerun after the correction: **19 requests**
(11 main example requests and 8 scenario checks) matched their expected
responses and SQLite changes, including intentional 400/404 outcomes. Their
command hashes still match [API_EXAMPLES.md](API_EXAMPLES.md). See
[EXAMPLE_VERIFICATION.md](EXAMPLE_VERIFICATION.md) for preconditions and results.

## Working data and local service

Read-only snapshots before the work and after restarting the service matched:
**4 tasks**, unchanged column metadata and schema, and the `tasks` sequence
still **4**. `PRAGMA integrity_check` returned **ok**. None of the mutation
examples used the working database.

The service was restarted using the approved Node 20.20.2 installation on
`http://localhost:3000`. Final GET checks returned 200 for `/health` and `/tasks`;
the listing matched the preserved working rows. Process details are recorded
locally in `service.json`.

README SHA-256 remains
`4a0c1a800e53dea3d4ee2d5ac280f558bf5d6270d991e9de777b9c1386cc3f1c`.
The historical payload remains exactly **111923 bytes**, SHA-256
`02e84b2ebcd226bead7369454a5b875b58e0c01b348cac793c8dbe8012d8f5b4`.
These checks use the previously recorded hashes and require no Git access.

## Local evidence

Evidence is under `data/local-closure/`, excluded from the delivery:

| Files | Evidence |
| --- | --- |
| `summary.json`, `verification.log` | Final results, matching input hashes, installed versions, and live GET checks. |
| `tests.log`, `url-tests.log`, `build.log`, `typecheck.log` | Full and focused tests, compilation, and source/test types. |
| `audit.json`, `dependency-tree.json`, `dependency-changes.json`, `install.log` | Real audit output, installed versions, exact dependency scope, and installation. |
| `integration-results.json`, `integration-run.log` | The 29-request sequence, 98 assertions, independent database snapshots, and cleanup. |
| `curl-results.json`, `examples.log` | The 19 repeated example requests with expected HTTP/SQLite results. |
| `before.json`, `preservation.json`, `service.json` | Working rows/schema/sequence before and after, original hashes, and running service. |
| `short-run.json`, `cleanup.json`, `documentation.json` | Short-path test inputs, retained-copy cleanup status, and final documentation checks. |

## Remaining limits

The route-error matcher follows the installed Express 4 error signature and
must be rechecked when changing that framework behavior. The qs override is
intentional and temporary until an approved Express release permits patched qs
without it. The existing `prebuild-install@7.1.3` deprecation notice remains;
it is distinct from the zero-vulnerability audit and belongs to a separately
reviewed native-driver/runtime upgrade.

The original compatibility choices remain: timezone-free due dates, an explicit
ID ceiling, and the list envelope. Migration comparison covers tasks and their
sequence, with a bounded SQL schema recognizer rather than general equivalence.
These limits are detailed in [TECHNICAL_DECISIONS.md](TECHNICAL_DECISIONS.md).
Verification was performed on Windows with Node 20.20.2; it does not establish
compatibility with every runtime or platform. Publication was outside this
verification phase and is now separately authorized; these results do not
assert that any publication step has been completed.
