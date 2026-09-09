# Dependency review

Reviewed on **2026-09-09**, with Node **20.20.2** and npm **10.8.2**.
Status: **the authorized correction is applied to the working project**.
The final dependency correction changes only the body-parser and qs lockfile
entries compared with the pre-correction project. This PR separately adds Zod
and jsonc-parser for input validation in the earlier implementation. A clean
installation with Node 20.20.2 completed successfully. Express 4.22.2 and
better-sqlite3 11.10.0 remain unchanged; no general dependency update was run.
The final working-project installation, audit, and regression results are
recorded in [LOCAL_VERIFICATION.md](LOCAL_VERIFICATION.md). The original
isolated-candidate checks below remain historical evidence, not a substitute
for those final checks.

The applied-project audit reports **zero vulnerabilities**. The final full
suite passed **97 tests**, with no failures, skips, or cancellations; build and
source-and-test type checking also passed. Node 20.20.2 was used throughout.

## Finding and application exposure

The initial `npm audit --json` reported **three moderate affected packages** arising from
**two advisories in qs**. Express and body-parser inherit the finding through qs;
these are not three independent application defects. No high or critical
findings were reported by this audit.

| Package before correction | Version | Dependency relationship |
| --- | --- | --- |
| express | 4.22.2 | Direct dependency; requests qs `~6.15.1` and body-parser `~1.20.5`. |
| body-parser | 1.20.6 | Express dependency; also requests qs `~6.15.1`. |
| qs | 6.15.3 | One installed copy shared by both paths. |

The first advisory concerns bracketed comma lists bypassing configured array
limits when comma parsing is enabled. The second concerns an exception when
`qs.stringify` receives a non-callable `constructor.isBuffer` property. Both
identify **6.16.0** as patched. Sources:
[array-limit advisory](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) and
[isBuffer advisory](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g).

Application-specific assessment:

- Express 4's default extended query middleware calls qs before our controllers.
  Using `URLSearchParams` in [tasks.controller.ts](../src/controllers/tasks.controller.ts)
  preserves strict filter rules but does not remove that earlier execution.
- Our application neither enables qs comma parsing nor calls `qs.stringify`
  on request objects. The reviewed code does not establish the full prerequisites
  of either published exploit through a current endpoint.
- [app.ts](../src/app.ts) registers `express.json`, never `express.urlencoded`;
  body-parser's URL-encoded qs path is not used.
- The correction removes vulnerable dependency versions. This review does not
  claim an HTTP denial of service was reproduced against the running API.

## Authorized correction and exact scope

| Element | Before correction | Authorized result | Effect |
| --- | --- | --- | --- |
| express | 4.22.2 | 4.22.2 | Retain the current implementation and direct range `^4.21.2`. |
| body-parser | 1.20.6 | 1.20.8 | Patch update within Express's allowed range; now requests qs `~6.16.0`. |
| qs | 6.15.3 | 6.16.0 | Fix both reported advisories. |
| Node requirement | `>=20` | `>=20` | Preserve the exercise requirement; verify with 20.20.2. |
| better-sqlite3 | 11.10.0, range `^11.8.1` | Unchanged | Preserve the agreed native driver/runtime pairing. |

The authorized entry in the root package.json is:

```json
{
  "overrides": {
    "express": {
      "qs": "6.16.0"
    }
  }
}
```

This nested override applies to qs under Express, including descendants; it
does not add qs or body-parser as direct dependencies. See
[npm's override rules](https://docs.npmjs.com/cli/v10/configuring-npm/package-json/#overrides).

The dependency correction changes **only the body-parser and qs lockfile entries**, including
integrity hashes and body-parser's qs range. Every other package locked before
that correction remains unchanged. Neither package becomes a direct dependency. The separate route
decoding correction and source-and-test type-check command are local-closure
changes; they are not additional dependency upgrades.

The registry's `latest-4` tag was still **4.22.2** at review time. Its qs range
does not admit 6.16.0, so a lockfile refresh alone cannot fix both dependency
paths. The override makes that exception explicit. Changing the Express major
or Node/SQLite pairing would expand this correction beyond its necessary scope.

The [qs changelog](https://github.com/ljharb/qs/blob/main/CHANGELOG.md) describes
the fixes and additional parsing changes in 6.16.0. The
[body-parser 1.20.8 history](https://github.com/expressjs/body-parser/blob/1.20.8/HISTORY.md)
documents its release. Regression checks establish compatibility for this app.

## Historical isolated verification

The candidate has its own clean installation. SHA-256 checks confirmed that
**26 source, test, schema, and configuration files** matched the current project.
Only the proposed dependency files differed. Tests used temporary databases.

| Check | Result |
| --- | --- |
| Clean `npm ci` with Node 20.20.2 | Passed, including the native SQLite installation. |
| `npm ls express body-parser qs better-sqlite3 --all` | Express 4.22.2, body-parser 1.20.8, one shared qs 6.16.0, better-sqlite3 11.10.0; valid tree. |
| `npm audit --json` | **0 reported vulnerabilities**, versus 3 affected packages before the proposal. |
| `npm run test:db` | **90 passed**, 0 failed, skipped, or cancelled; 35.286 seconds. |
| `npm run build` | Passed. |
| Two small qs advisory reproductions | Old qs reproduced both defects; the candidate enforced the comma limit and safely serialized the hostile property shape. |
| HTTP comparison | **18 requests**: nine requests each against current and candidate applications, with identical status/body results. |
| Working database | Four tasks, column metadata, schema, and sequence matched the read-only baseline; integrity remained `ok`. |
| Working package files and README at that stage | Hashes unchanged; the candidate had not yet been applied to the working project. |

HTTP comparisons covered the six agreed filter examples, two short adversarial
query shapes, and a subsequent health check. Both apps returned the existing
400 contract for the unknown structured queries. Direct qs reproductions tested
the advisory options separately, without changing the application's parser.

The existing suite also covers CRUD, ID limits, atomic batches, invalid filters,
JSON syntax and size limits, encodings, rollback, dates, startup, and migrations.
No broad test infrastructure or application workaround was added.

Local evidence resides under ignored `data/dependency-review/`:
`audit-before.json`, `audit-candidate.json`, `candidate-tree.json`,
`candidate-tests.log`, `candidate-build.log`, and `candidate-verification.json`.
These logs are not part of the delivery; committed tests and the listed commands
provide the reproducible verification path.

## Trade-off and verification boundary

The override deliberately exceeds Express's declared qs minor range. It is
narrow, visible, and tested here. Remove it once the selected Express 4 release
natively admits patched qs and installation, audit, and regressions pass without
the override. This removal condition prevents an unexplained permanent pin.

Installation also emitted a deprecation notice for the existing
`prebuild-install@7.1.3` native-install helper. This is separate from the three
audit findings and unchanged by this proposal. A future driver/runtime review
can address it within an explicitly agreed scope. Zero audit findings describe
known advisories at the recorded time, not a guarantee against unreported issues.

The user explicitly authorized this exact correction after the initial review,
while retaining Node >=20, verification with 20.20.2, Express 4.22.2, and
better-sqlite3 11.10.0. The earlier approval boundary is resolved; it does not
remain an outstanding decision.

Final checks verify the installed dependencies and final project inputs:
installation, dependency tree, audit, build, and source/test types in the working
project; the full suite in a short-path copy with matching input hashes; and
integrated HTTP/SQLite and example verification using isolated databases.
[LOCAL_VERIFICATION.md](LOCAL_VERIFICATION.md) records actual results, exact
scope of changed packages, and working-data preservation. Do not substitute
the historical zero-alert candidate audit for the final installed audit.

[PULL_REQUEST_DRAFT.md](PULL_REQUEST_DRAFT.md) has been reviewed for publication.
Fork setup, signed commits, branch publication, and PR creation were outside the
completed local technical closure. The user has since authorized that separate
publication phase; its execution status is tracked in [WORK_PLAN.md](../WORK_PLAN.md).
