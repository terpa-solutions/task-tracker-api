-- Sample rows cover a spread of completed/priority combinations (and both a
-- present and absent due_date) so the GET /tasks filters have something
-- meaningful to exercise on a fresh clone.
INSERT INTO tasks (title, completed, priority, due_date) VALUES
  ('Set up local development environment', 1, 'high', '2026-08-01'),
  ('Review the interview ticket in the README', 0, 'high', '2026-08-05'),
  ('Sketch out the API changes before writing code', 0, 'medium', NULL),
  ('Open a pull request with the completed work', 0, 'low', '2026-08-08'),
  ('Archive the old planning notes', 1, 'low', NULL);
