import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { createTaskModel } from '../src/models/tasks.model.js';

test('un SyntaxError interno devuelve 500 y registra la causa sin copiar el cuerpo de la solicitud', async () => {
  const app = express();
  const cause = new SyntaxError('private SQL failure at C:/private/database/tasks.sql');
  app.use(express.json());
  app.post('/internal-failure', () => { throw cause; });
  app.use(errorHandler);
  const logged: unknown[][] = [];
  const originalConsoleError = console.error;
  let server: Server | undefined;
  try {
    console.error = (...args: unknown[]) => { logged.push(args); };
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address !== null && typeof address === 'object');
    const requestSecret = 'request-body-secret-that-must-not-be-logged';
    const response = await fetch(`http://127.0.0.1:${address.port}/internal-failure`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privatePayload: requestSecret }),
    });
    assert.equal(response.status, 500);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(await response.json(), { error: 'Internal server error.' });
    assert.deepEqual(logged, [['Request failed', {
      method: 'POST', path: '/internal-failure',
      cause: { name: 'SyntaxError', message: cause.message, stack: cause.stack },
    }]]);
    assert.equal(JSON.stringify(logged).includes(requestSecret), false);
  } finally {
    console.error = originalConsoleError;
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close(error => error ? reject(error) : resolve());
      });
    }
  }
});

test('si los encabezados ya se enviaron, delega el error sin intentar otra respuesta', () => {
  const cause = new Error('Failure after headers were sent');
  const delegated: unknown[] = [];
  const request = { method: 'GET', path: '/already-started' } as Request;
  const response: Pick<Response, 'headersSent' | 'status' | 'json'> = {
    headersSent: true,
    status() { assert.fail('The handler must not change the status after headers were sent.'); },
    json() { assert.fail('The handler must not send a second JSON response.'); },
  };
  const next: NextFunction = (error?: unknown) => { delegated.push(error); };
  errorHandler(cause, request, response as Response, next);
  assert.equal(delegated.length, 1);
  assert.equal(delegated[0], cause);
});

for (const method of ['PATCH', 'DELETE']) {
  for (const encodedId of ['%', '%E0%A4%A']) {
    test(`${method} /tasks/${encodedId} returns 400 before model access and preserves SQLite`, async (t) => {
      const db = openDatabase({ filename: ':memory:' });
      let server: Server | undefined;
      try {
        const model = createTaskModel(db);
        const calls = [
          t.mock.method(model, 'listTasks'),
          t.mock.method(model, 'taskExists'),
          t.mock.method(model, 'createTask'),
          t.mock.method(model, 'updateTask'),
          t.mock.method(model, 'deleteTask'),
          t.mock.method(model, 'bulkCompleteTasks'),
        ];
        const snapshot = () => ({
          rows: db.prepare('SELECT * FROM tasks ORDER BY id').safeIntegers(true).all(),
          schema: db.prepare('SELECT * FROM sqlite_master ORDER BY type, name').safeIntegers(true).all(),
          sequence: db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').safeIntegers(true).all(),
        });
        const before = snapshot();
        server = createApp(model).listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        assert.ok(address !== null && typeof address === 'object');

        const response = await fetch(`http://127.0.0.1:${address.port}/tasks/${encodedId}`, {
          method,
          ...(method === 'PATCH' ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'This change must not reach the model' }),
          } : {}),
        });

        assert.equal(response.status, 400);
        assert.match(response.headers.get('content-type') ?? '', /application\/json/);
        assert.deepEqual(await response.json(), {
          error: 'Invalid URL encoding. Use a valid percent-encoded task ID.',
        });
        for (const call of calls) assert.equal(call.mock.callCount(), 0);
        assert.deepEqual(snapshot(), before);
      } finally {
        if (server?.listening) {
          await new Promise<void>((resolve, reject) => {
            server!.close(error => error ? reject(error) : resolve());
          });
        }
        db.close();
      }
    });
  }
}

for (const cause of [
  new URIError('Internal URI processing failed'),
  Object.assign(new URIError('Internal URI processing failed'), { status: 400, statusCode: 400 }),
  new URIError("Failed to decode param '%'"),
]) {
  test(`an internal URIError stays 500 without the complete Express route-decoding signature: ${cause.message} (status ${'status' in cause ? cause.status : 'absent'})`, async (t) => {
    const app = express();
    app.patch('/internal-uri-failure', () => { throw cause; });
    app.use(errorHandler);
    const logged = t.mock.method(console, 'error', () => {});
    let server: Server | undefined;
    try {
      server = app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address !== null && typeof address === 'object');
      const response = await fetch(`http://127.0.0.1:${address.port}/internal-uri-failure`, { method: 'PATCH' });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Internal server error.' });
      assert.equal(logged.mock.callCount(), 1);
      assert.deepEqual(logged.mock.calls[0].arguments, ['Request failed', {
        method: 'PATCH', path: '/internal-uri-failure',
        cause: { name: 'URIError', message: cause.message, stack: cause.stack },
      }]);
    } finally {
      if (server?.listening) {
        await new Promise<void>((resolve, reject) => {
          server!.close(error => error ? reject(error) : resolve());
        });
      }
    }
  });
}
