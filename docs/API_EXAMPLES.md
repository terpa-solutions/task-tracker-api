# API examples

Base URL: `http://localhost:3000`. Use the method, URL, and JSON body
with your preferred HTTP client. Send `Content-Type: application/json`
when including a body. Replace `{id}` with the ID returned by creation,
or with the ID of the task you want to update.

The [HTTP contract](HTTP_CONTRACT.md) details inputs and errors.
The [README](../README.md) preserves the original exercise at the user's
request; these examples describe the implemented API.

## Create

`POST /tasks`

```json
{"title":"Prepare report","priority":"high","due_date":"2099-12-31 18:00:00"}
```

Returns 201 and the saved task, including its `id`. When `priority`
and `due_date` are omitted, they default to `medium` and `null`.

## List

| Method and URL | Selection |
| --- | --- |
| `GET /tasks` | All tasks. |
| `GET /tasks?priority=low,medium` | Low or medium priority. |
| `GET /tasks?priority=low,high` | Low or high priority. |
| `GET /tasks?priority=medium,high` | Medium or high priority. |
| `GET /tasks?completed=false&priority=low,high` | Pending tasks with low or high priority. |
| `GET /tasks?completed=true,false&priority=low,medium,high` | All tasks. |

Returns 200 with `{"tasks":[...],"message":null}` when results exist.
Without matches, returns
`{"tasks":[],"message":"No matching tasks found."}`, also with 200.

## Update or remove the date

`PATCH /tasks/{id}`

```json
{"priority":"low","completed":true}
```

Returns 200 and the updated task; omitted fields retain their values.
To remove the date immediately, send this body to the same endpoint:

```json
{"due_date":""}
```

`{"due_date":null}` is also accepted. Sending only spaces in PATCH returns
400. A request containing both valid and invalid fields is rejected in full.

## Complete a batch

`POST /tasks/bulk-complete`

```json
{"ids":[1,2,3]}
```

The IDs must exist. In the initial sample data, task 1 is already completed
and the other two are pending: returns 200 with `{"updated":2}`. Repeating
the request returns `{"updated":0}`. If any ID is missing, returns 404 and
leaves the entire batch unchanged. List the current IDs first if your data differs.

## Delete

`DELETE /tasks/{id}`, without a body. Returns 204 when the task is deleted.

Malformed URL examples: `PATCH /tasks/%`, `DELETE /tasks/%`, and the same
methods with `/tasks/%E0%A4%A` return 400:

```json
{"error":"Invalid URL encoding. Use a valid percent-encoded task ID."}
```

These requests do not call the task model or change SQLite. Use a correctly
encoded route containing the intended decimal task ID, such as `/tasks/1`.

## Verified curl reference

Each block was verified against an independent temporary database containing
the four initial tasks. The command text matches the verified version. The original
quick start deletes ID 1: running the batch afterward with that ID returns 404.
In the new-field commands, replace `/5` with the ID returned by creation.
The results and these preconditions are recorded in
[EXAMPLE_VERIFICATION.md](EXAMPLE_VERIFICATION.md).

A curl exit code of 0 does not guarantee a successful HTTP status. Check
the response status and body as well; the last PATCH deliberately returns 400.

### Original quick start

```bash
# Health check
curl http://localhost:3000/health

# List all tasks (returns the seeded sample data)
curl http://localhost:3000/tasks

# Create a task
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Write the pull request description"}'

# Update a task (title and/or completed)
curl -X PATCH http://localhost:3000/tasks/1 \
  -H "Content-Type: application/json" \
  -d '{"completed":true}'

# Delete a task
curl -X DELETE http://localhost:3000/tasks/1
```

### Filter

```bash
curl 'http://localhost:3000/tasks?completed=false&priority=low,high'
```

### Batch

```bash
# Replace the IDs with existing tasks. The count is the number actually changed.
curl -X POST http://localhost:3000/tasks/bulk-complete \
  -H 'Content-Type: application/json' \
  -d '{"ids":[1,2,3]}'
```

### New fields

```bash
# Create a task with an explicit priority and date.
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Prepare report","priority":"high","due_date":"2099-12-31 18:00:00"}'

# Replace 5 with the ID returned by creation. Omitted fields stay unchanged.
curl -X PATCH http://localhost:3000/tasks/5 \
  -H "Content-Type: application/json" \
  -d '{"priority":"low","completed":true}'

# Remove the date immediately.
curl -X PATCH http://localhost:3000/tasks/5 \
  -H "Content-Type: application/json" \
  -d '{"due_date":""}'

# Returns 400 with errors for both priority and due_date; nothing is changed.
curl -X PATCH http://localhost:3000/tasks/5 \
  -H "Content-Type: application/json" \
  -d '{"priority":"HIGH","due_date":"   "}'
```
