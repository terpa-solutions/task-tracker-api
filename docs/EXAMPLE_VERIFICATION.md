# Example verification

The expanded examples are maintained in [API_EXAMPLES.md](API_EXAMPLES.md).
At the user's request, `README.md` was restored to the original repository
version previously recorded as commit `69f968a`. During the local closure,
its SHA-256 remains
`4a0c1a800e53dea3d4ee2d5ac280f558bf5d6270d991e9de777b9c1386cc3f1c`;
no Git command is needed to compare that recorded hash. Its quick-start block
matches the first example covered by this document verbatim and was also
executed. Explanations of the current behavior belong in separate documentation
and the future PR description.

## Method

Each block's text is executed, replacing only the host and port with those
of a temporary API. Each block starts with four sample tasks: IDs 1 through 4,
only the first completed, and all with `medium` priority. The API uses
Node 20.20.2, the actual application code, and its own SQLite database.

The HTTP status and body of each response are recorded, and SQLite rows and
sequence are compared before and after. A successful curl exit alone does
not verify the HTTP contract. Temporary databases are closed and deleted
afterward; the working database is queried in read-only mode to verify
that it remains unchanged.

## Final Bash and curl results

Repeated after the route-error correction and authorized dependency update on
2026-09-09, with Bash 5.3.15, curl 8.21.0, and Node 20.20.2 for the API.
Installed versions were Express 4.22.2, body-parser 1.20.8, qs 6.16.0, and
better-sqlite3 11.10.0. Short independent temporary paths under `C:\tt-check`
avoid the Windows path-length failure observed during review.

| Example | HTTP statuses | Result verified in SQLite |
| --- | --- | --- |
| Original quick start | 200, 200, 201, 200, 204 | Creates ID 5, preserves the completed status of ID 1, and deletes ID 1; sequence 5. |
| Pending low/high filter | 200 | No matches in the initial data; returns `tasks: []` and the agreed message without writing. |
| Complete IDs 1, 2, and 3 | 200 | `updated: 2`; only the two pending states change. |
| New fields | 201, 200, 200, 400 | Creates ID 5, changes priority/status, removes the date, and rejects invalid priority/date inputs without applying changes. |

All 11 requests in the four blocks passed their checks. Another 8 requests
were verified across two additional scenarios:

- Quick start followed by a batch: the first block deletes ID 1; the batch returns
  `404` with `{"error":"Tasks not found: 1."}` and leaves the database exactly
  as it was before that request. This sequence is not presented as a successful
  batch execution.
- Repeated batch in a fresh database: first `{"updated":2}`, then
  `{"updated":0}`, with the counter limited to actual changes.

The new-field block uses `/tasks/5` only because its comment asks readers to
substitute the returned ID and the initial sequence yields 5. In another database,
use the ID from the response. This block leaves that task in place; it is deleted
with its temporary database when verification ends.

Final local evidence: `data/local-closure/curl-results.json`, verified at
`2026-09-09T07:42:55.748Z`, with the execution log in
`data/local-closure/examples.log`. The result includes commands, versions, block hashes,
statuses, responses, and SQLite snapshots. The real database retained its
four tasks, schema, and sequence.

The final presentation uses methods, URLs, and JSON independent of the HTTP client.
The four curl blocks retain the exact commands that were executed. The earlier
documentation-only review also checked links, example JSON, and 41 cited test
names, separately from this final example run. The history preserves the entire
previous document of 111923 bytes, verified using SHA256. Evidence for these checks:
`data/documentation-check/docs-check.json`.

## Final local closure and automated tests

These checks verify executable examples and their preconditions against the
final installed dependencies. The separate integrated check passed 29 HTTP
requests and 98 assertions using two independent temporary databases, including
the generic malformed-URL examples; those databases were closed and removed.
[LOCAL_VERIFICATION.md](LOCAL_VERIFICATION.md) records the integrated request
sequence, exact regression/type/build/audit results, and working-data preservation.
The regression suite remains available through `npm run test:db`, application
compilation through `npm run build`, and source-and-test types through
`npm run typecheck`, using Node 20.20.2.
The contracts and their links to test names are documented in
[HTTP_CONTRACT.md](HTTP_CONTRACT.md) and
[BUSINESS_RULES.txt](../BUSINESS_RULES.txt).

The evidence files under `data/` are local artifacts ignored by Git;
this document preserves the method, results, and limitations for delivery.
