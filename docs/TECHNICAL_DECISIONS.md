# Technical decisions and delivery differences

Current rules are in [BUSINESS_RULES.txt](../BUSINESS_RULES.txt), and the
implemented interface is in [HTTP_CONTRACT.md](HTTP_CONTRACT.md).
This document explains adopted decisions and separates outstanding work.
The complete history, including superseded agreements, remains in
[DECISION_HISTORY.txt](DECISION_HISTORY.txt), a non-normative archive.
Quoted Spanish user statements and exact test names remain verbatim as evidence.

## Original README and additional documentation

At the user's explicit request, README.md remains identical to the original
at commit 69f968a, with blob 32153d5c83a7b389a6704df12111afe59f7a1159.
It contains the introduction, ticket, and starter API examples. The current
contract is in HTTP_CONTRACT.md; method, URL, and JSON examples are in
[API_EXAMPLES.md](API_EXAMPLES.md), with supporting curl commands. No particular
client is required. Results are recorded in
[EXAMPLE_VERIFICATION.md](EXAMPLE_VERIFICATION.md).

The original ticket requests a README update. The user's subsequent instruction
was to preserve that file and explain the differences when preparing the PR.
Current documentation is delivered separately; this is not presented as literal
completion of the original README editing requirement.

**Published [PR #2](https://github.com/terpa-solutions/task-tracker-api/pull/2):**
the description explains the separate documentation, multiple filter selections,
consistent listing object, agreed date format, ID limit, seeding behavior, and
environment choice. [PULL_REQUEST_DRAFT.md](PULL_REQUEST_DRAFT.md) retains the
description locally. The PR is open; publication does not imply upstream approval.

## Adopted environment and dependencies

| Component | Current decision | Rationale and scope |
| --- | --- | --- |
| Node | Keep the >=20 requirement; verify locally with 20.20.2. | Respect the original exercise requirement. |
| better-sqlite3 | Original ^11.8.1 range; locked to 11.10.0. | Retain the alternative compatible with the agreed environment. |
| Express and parser dependencies | Express 4.22.2; body-parser 1.20.8; qs 6.16.0 overridden only under Express. | Apply the authorized advisory correction without broad upgrades. |
| Zod | Exactly 4.5.4. | The user specified "siempre zod"; centralize validation. |
| jsonc-parser | Exactly 3.3.1, without runtime dependencies. | Inspect numbers and properties as received in bulk JSON. |

J-13 records the user's rationale: "quiero mantener el requisito original y
adaptarme a el para la limitacion pero hacer la opcerbacion que se podria hacer
ese cambio pero no quise tomar esa facultad". The ID limit remains 1..500000
and does not require increasing the minimum Node version.

A native abort was reproduced with Node 24.20.0 and better-sqlite3 11.10.0.
The alternative using better-sqlite3 13.0.3 and a Node 22 minimum was tested and
then excluded from the deliverable. Its test results are historical; the current
implementation was verified with Node 20.20.2 and better-sqlite3 11.10.0.

The portable runtime under data/toolchains is a local resource excluded from
Git. The deliverable does not require that directory: install Node 20 and run
the regular scripts. Since better-sqlite3 is native, installation and execution
must use the agreed compatible environment.

## TypeScript and separation of responsibilities

RN-ARQ-01 retains .ts files for application sources, tests, and project helpers.
The original configuration uses ESM with type: module and TypeScript NodeNext.
Relative .js import references target compiled output; .mts, .cts, and .cjs
source files were not adopted.

| Component | Responsibility |
| --- | --- |
| src/db.ts, openDatabase(options) | Open and initialize a connection when requested. |
| src/models/tasks.model.ts, createTaskModel(db) | Prepare queries and transactions for that connection. |
| src/controllers/tasks.controller.ts | Validate requests and build the agreed HTTP responses. |
| src/routes/tasks.ts | Associate methods and paths with controllers. |
| src/app.ts, createApp(model, {now}) | Compose Express, the parser, routes, and error handler. |
| src/index.ts | Open the connection, compose the app, and listen on port 3000. |

Importing application modules does not open SQLite or listen on ports.
openDatabase closes its connection if initialization fails; the caller closes
the returned connection after shutting down the server. Tests can create
independent applications with separate databases without activating the work database.

Approved rationale: simplify maintenance and isolation without additional
injection infrastructure. Factories preserve the existing contracts.
Coverage in [api-safety.test.ts](../tests/api-safety.test.ts):
"importar los módulos de la aplicación no abre SQLite ni crea archivos de datos"
and "dos aplicaciones simultáneas mantienen aisladas sus bases y utilizan el reloj inyectado".

## Validation and the original JSON representation

Zod schemas are separated by body, date, filters, and bulk operation.
PRIORITIES in src/types.ts supplies the Priority type and priority schemas.
validation-errors.ts shares error traversal while preserving one entry per
field, messages, and order. Approved rationale: avoid duplicate catalogs and
error processing that could diverge.

Express checks JSON syntax. Its hook captures the body before JSON.parse;
after parsing, the jsonc-parser scanner extracts the original number and
property text so Zod can validate before SQLite is called. Comments and
trailing commas are not accepted. Adding jsonc-parser was an implementation
decision within the technical judgment delegated by the user.

JSON.parse alone loses differences between 1, 1.0, 1e0, and certain rounded
numbers, and retains the last repeated property. Keeping the original permits
rejection of those forms and duplicate ids properties. Validation is not tied
to a single capitalization or slash spelling of the route; it preserves
the route semantics already accepted by Express.

GET validation reads the original query using URLSearchParams, independently
of the object produced by Express, so repeated keys, names, and structured
notation are not silently merged or discarded by our validator. Express's
default query parser still runs before the controller; this does not bypass
its qs dependency. Model queries use SQL parameters and fixed column names.

Malformed percent encoding is rejected while Express decodes route parameters.
The handler recognizes a URIError with Express's status/statusCode 400 and
`Failed to decode param '…'` message, then returns 400 with English correction
guidance before the model runs. It does not convert every
URIError or SyntaxError into a client error: internal failures remain generic
500 responses with server-side diagnostics. See [HTTP_CONTRACT.md](HTTP_CONTRACT.md)
and [LOCAL_VERIFICATION.md](LOCAL_VERIFICATION.md) for the exact message and checks.

Coverage in [task-validation.test.ts](../tests/task-validation.test.ts):
"los errores del cuerpo mantienen mensajes, orden y una entrada por campo" and
"el lote conserva la escritura original, el índice y la precedencia de ids repetido";
in [api-safety.test.ts](../tests/api-safety.test.ts):
"GET rechaza parámetros desconocidos, arreglos y objetos sin descartarlos silenciosamente".

## Date: original requirement and subsequent agreement

The ticket literally says **"optional ISO date string"**. The user subsequently
chose **YYYY-MM-DD HH:mm:ss**, with a space, whole seconds, and no time zone.
J-04 preserves the answers "no tenemos zona horaria" and
"Espacio, como created_at: 2026-09-10 14:30:00".

The implementation enforces that exact agreed format; it does not present it
as a transcription of the ticket or promise to accept RFC 3339 formats. The
difference must be explained in the PR. The original README is not rewritten
to attribute this later clarification to the original requirement.

Absence handling, calendar validation, and day comparison are separate.
Tests use an injected clock; production reads the host's local day for each
request. due_date has no time-zone conversion, and SQLite still generates
created_at using datetime('now'). The rule permits any time today and future
days; a past date omitted from PATCH or left unchanged by a batch stays intact.

Coverage in [task-validation.test.ts](../tests/task-validation.test.ts):
"el calendario y la hora rechazan fechas imposibles sin normalizarlas" and
"la misma marca de tiempo usa el día local en ambos lados de medianoche UTC".

## Transactions, seeding, and preservation

Creation checks capacity and inserts within the same transaction.
Bulk completion uses an immediate transaction to check every ID and change
only pending states; its counter reflects actual transitions, and any failure
rolls back the operation. Completing a batch leaves dates, other fields, and
the sequence unchanged.

Within its transaction, initialization detects whether tasks existed before
applying schema.sql. Only a newly created table receives examples. An existing
empty table remains empty and retains its sequence. Presented and approved
rationale: respect deliberate deletion and avoid consuming IDs on restart.

The npm run db:update command is run explicitly. It backs up using SQLite's
native API, including committed WAL data. Each execution creates a separate
file with a date, time, and unique suffix under data/backups. The same tasks.db
file is updated within a transaction.

The lightweight preliminary check validates required original columns. The
reference snapshot comes from the backup; data is compared before and after
the change. captureTasks reads exact integers per statement in rows, metadata,
and sequence, independently of the caller's defaultSafeIntegers setting.

Comparison covers tasks column metadata, every column's values, including
generated columns, rows, IDs, and its sqlite_sequence entry. It does not compare
other tables or the complete DDL. Integrity and foreign keys are separate
checks. Differences roll back the update and retain the backup; output identifies
the stage and expected/actual values where applicable.

Coverage in [database-update.test.ts](../tests/database-update.test.ts):
"el comando real de actualización respalda, conserva datos exactos y es idempotente en otro proceso",
"captura enteros exactos y metadatos iguales sin depender de defaultSafeIntegers",
"la comparación de conservación está limitada a tasks y su secuencia",
and "un fallo de integridad posterior revierte también las columnas agregadas".

## Scope of the schema analyzer

The priority column must be TEXT NOT NULL with literal default 'medium',
binary collation, and the supported CHECK (priority IN ('low','medium','high'))
form. Comments, quoted identifiers, outer parentheses, and different ordering
of the three values are recognized. due_date must be an ordinary nullable
TEXT column with a NULL or omitted default.

The analyzer recognizes that declaration; it does not prove general SQL
equivalence. An equivalent expression written with OR is rejected for review.
An incompatible existing column is not automatically repaired. This limit
follows the explicit decision to cancel and report without altering data.

Coverage in [database-update.test.ts](../tests/database-update.test.ts):
"valida default, NOT NULL, CHECK real y collation de priority, incluso sin filas"
and "acepta la forma CHECK soportada con identificador citado, orden distinto y default entre paréntesis".

## Verification and delivery status

The final working-project results are recorded in
[LOCAL_VERIFICATION.md](LOCAL_VERIFICATION.md): the full regression suite,
application build, source-and-test type checking, post-install audit, integrated
HTTP/SQLite checks, repeated examples, and working-data preservation.
Historical candidate results remain separately labeled in
[DEPENDENCY_REVIEW.md](DEPENDENCY_REVIEW.md).

`npm run typecheck` uses `tsconfig.tests.json` to check both src and tests with
no emitted files. The production build remains separate. This closes the gap
where running tests through tsx exercised behavior without checking test types.

Regular HTTP tests use temporary databases. Startup, restart, import-side-effect,
local-date, and CLI checks retain separate processes where isolation is needed.
The linked test names identify coverage without relying only on a test count.

Completed delivery steps are tracked in [WORK_PLAN.md](../WORK_PLAN.md):

- **Activity 6:** the authorized dependency proposal is applied in this
  local closure. Express 4.22.2 and its direct range remain unchanged;
  `overrides: { express: { qs: '6.16.0' } }` selects patched qs, and body-parser
  resolves to 1.20.8. Node and better-sqlite3 remain unchanged. Final execution
  results and any remaining limits belong in LOCAL_VERIFICATION.md.
- **Activity 5:** published [PR #2](https://github.com/terpa-solutions/task-tracker-api/pull/2)
  from `isaac12odin:codex/task-tracker-api-delivery` to upstream `main` with a
  verified signed delivery commit. The reviewed English description explains
  the differences above, their rationale, verification, limits, and proportionate
  future scaling proposals without presenting those proposals as implemented
  features. Upstream review and merge are separate from this completed publication.

**Optional proposal, not a requirement or blocker:** add an npm test alias.
The current checks are npm run test:db, npm run build, and npm run typecheck;
the npm test alias does not exist.

**Alternative not adopted:** raise the minimum to Node 22 and use better-sqlite3
13.0.3. The current environment choice is resolved; this alternative is neither
an outstanding decision nor a condition for completing delivery.
