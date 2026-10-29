# Archivos nuevos y modificados

## Archivos modificados

### `schema.sql`
**Qué cambió:** Se eliminaron los `ALTER TABLE` que se intentaron poner aquí inicialmente.  
**Por qué:** SQLite no soporta `ALTER TABLE ADD COLUMN IF NOT EXISTS`. La migración se movió a `src/db.ts` donde se puede verificar la existencia de columnas via `PRAGMA table_info` antes de ejecutar el `ALTER TABLE`, logrando el mismo efecto idempotente de forma compatible.

---

### `seed.sql`
**Qué cambió:** Los `INSERT` ahora incluyen el campo `priority` con valores reales.  
**Por qué:** Al agregar la columna `priority` al schema, el seed necesita proveer valores explícitos para que los datos de ejemplo sean representativos y útiles para probar los nuevos filtros (`?priority=high`, etc.). Sin esto, todos los registros seed quedarían con el default `'medium'` y no se podría verificar el filtrado visualmente.

---

### `src/db.ts`
**Qué cambió:** Se agregó la función `migrateSchema()` que se ejecuta después de `applySchema()`.  
**Por qué:** El schema base (`CREATE TABLE IF NOT EXISTS`) no puede incluir columnas nuevas sin romper instalaciones existentes. La migración revisa con `PRAGMA table_info(tasks)` qué columnas ya existen y solo ejecuta `ALTER TABLE` para las que faltan. Esto permite que una DB antigua levante sin pérdida de datos y que una DB nueva también funcione correctamente desde el inicio.

---

### `src/types.ts`
**Qué cambió:** Se añadió el tipo `Priority`, y se extendieron `TaskRow`, `Task` y `toTask` con los campos `priority` y `due_date`.  
**Por qué:** Los tipos son el contrato entre la base de datos y la API. Sin actualizarlos, TypeScript no detectaría usos incorrectos de los nuevos campos y el compilador daría errores en los routes que ya los utilizan.

---

### `src/index.ts`
**Qué cambió:** Se agregó `export default app` y el `app.listen()` se condicionó con `process.env.NODE_ENV !== 'test'`.  
**Por qué:** Los tests con `supertest` necesitan importar `app` directamente sin que el servidor ocupe el puerto 3000. Si `listen()` se llama al importar el módulo en los tests, el puerto queda ocupado entre suites y los tests fallan con `EADDRINUSE`. Vitest establece `NODE_ENV=test` automáticamente, por lo que la condición desactiva el binding solo en ese contexto.

---

### `src/routes/tasks.ts`
**Qué cambió:** Reescritura completa del router con cinco cambios principales:
1. Sustitución de validación manual (`typeof`) por Zod en todos los endpoints.
2. `GET /tasks` con construcción dinámica del WHERE para filtros combinables.
3. `POST /tasks` actualizado para aceptar `priority` y `due_date`.
4. `PATCH /tasks/:id` extendido para parchear `priority` y `due_date`.
5. Nuevo endpoint `POST /tasks/bulk-complete`.

**Por qué:** La validación manual era frágil y no cubría los nuevos campos. Zod centraliza las reglas y garantiza mensajes de error consistentes. El WHERE dinámico evita preparar una consulta distinta por cada combinación de filtros (serían 4 con 2 parámetros, 8 con 3, etc.). El endpoint `bulk-complete` se registra **antes** de `/:id` porque Express evalúa rutas en orden de registro; si `/:id` fuera primero, el string `"bulk-complete"` se interpretaría como un id numérico y retornaría 400.

---

### `README.md`
**Qué cambió:** Se actualizó la tabla de endpoints y se agregaron ejemplos curl para los nuevos features.  
**Por qué:** El ticket lo requiere explícitamente como paso 6. Una tabla desactualizada genera confusión al revisor del PR y al equipo que consulta la documentación.

---

### `package.json`
**Qué cambió:** Se agregó el script `"test": "vitest run"` y las dependencias `zod`, `vitest`, `supertest` y `@types/supertest`.  
**Por qué:** Sin el script `test`, `npm test` falla. Las dependencias nuevas son requeridas en runtime (`zod`) y en desarrollo (`vitest`, `supertest`) para la validación y los tests automatizados respectivamente.

---

## Archivos nuevos

### `src/validation.ts`
**Por qué se creó:** Centralizar todos los schemas Zod en un solo lugar en vez de definirlos inline dentro de los route handlers. Esto permite reutilizar los mismos schemas en los tests y en cualquier otro módulo que los necesite sin duplicar lógica de validación. También facilita encontrar y modificar las reglas de validación sin tener que buscar dentro de los handlers.

---

### `src/routes/tasks.test.ts`
**Por qué se creó:** El ticket requiere al menos 2 tests automatizados cubriendo el filtrado y el bulk-complete. Se implementaron 18 casos que cubren el happy path y los casos de error de todos los endpoints nuevos y modificados. Usar `supertest` permite probar la API a nivel HTTP (con headers, status codes y body reales) sin levantar un servidor en un puerto.

---

### `spec/ticket-spec.md`
**Por qué se creó:** Documento de planificación generado antes de escribir código. Define el gap entre el estado actual y lo requerido por el ticket, y especifica la implementación esperada de cada paso. Sirve como referencia durante el desarrollo y como documentación de decisiones de diseño para el revisor del PR.
