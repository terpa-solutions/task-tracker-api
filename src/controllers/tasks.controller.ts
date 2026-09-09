import type { Request, Response } from 'express';
import { TasksNotFoundError, type TaskModel } from '../models/tasks.model.js';
import { MAX_TASK_ID, parseTaskId, TaskIdRangeError } from '../task-id.js';
import { validateCreateTask, validateUpdateTask, taskValidationErrors, type FieldError } from '../schemas/tasks.schema.js';
import { validateTaskFilterQuery, taskFilterErrors } from '../schemas/task-filters.schema.js';
import type { TaskListResponse } from '../types.js';
import { validateBulkComplete } from '../schemas/bulk-complete.schema.js';
import { takeJsonSource } from '../middleware/json-body.js';

export function createTaskController(taskModel: TaskModel, now: () => Date = () => new Date()) {
  function listTasks(req: Request, res: Response<TaskListResponse | { errors: FieldError[] }>) {
    const queryStart = req.originalUrl.indexOf('?');
    const input = validateTaskFilterQuery(queryStart === -1 ? '' : req.originalUrl.slice(queryStart + 1));
    if (!input.success) return res.status(400).json({ errors: taskFilterErrors(input.error) });
    const tasks = taskModel.listTasks(input.data);
    res.json({
      tasks,
      message: tasks.length === 0 ? 'No matching tasks found.' : null,
    });
  }

  function createTask(req: Request, res: Response) {
    const input = validateCreateTask(req.body, now());
    if (!input.success) return res.status(400).json({ errors: taskValidationErrors(input.error) });
    try {
      res.status(201).json(taskModel.createTask(input.data));
    } catch (error) {
      if (error instanceof TaskIdRangeError) {
        return res.status(400).json({
          error: `Cannot create a task because the ID limit (${MAX_TASK_ID}) has been reached.`,
        });
      }
      throw error;
    }
  }

  function updateTask(req: Request, res: Response) {
    const id = parseTaskId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid task id.' });
    }
    // Preserve the existing order: route ID, task existence, then request body.
    if (!taskModel.taskExists(id)) {
      return res.status(404).json({ error: `Task ${id} not found.` });
    }
    const input = validateUpdateTask(req.body, now());
    if (!input.success) return res.status(400).json({ errors: taskValidationErrors(input.error) });
    res.json(taskModel.updateTask(id, input.data));
  }

  function deleteTask(req: Request, res: Response) {
    const id = parseTaskId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid task id.' });
    }
    if (!taskModel.deleteTask(id)) {
      return res.status(404).json({ error: `Task ${id} not found.` });
    }
    res.status(204).send();
  }

  function bulkCompleteTasks(req: Request, res: Response) {
    const input = validateBulkComplete(req.body, takeJsonSource(req));
    if (!input.success) return res.status(400).json({ errors: input.errors });
    try {
      res.json({ updated: taskModel.bulkCompleteTasks(input.data.ids) });
    } catch (error) {
      if (error instanceof TasksNotFoundError) {
        return res.status(404).json({ error: error.message });
      }
      throw error;
    }
  }

  return { listTasks, createTask, updateTask, deleteTask, bulkCompleteTasks };
}
