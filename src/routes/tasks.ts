import { Router } from 'express';
import { createTaskController } from '../controllers/tasks.controller.js';
import type { TaskModel } from '../models/tasks.model.js';

export function createTasksRouter(model: TaskModel, now?: () => Date) {
  const controller = createTaskController(model, now);
  const router = Router();
  router.get('/', controller.listTasks);
  router.post('/', controller.createTask);
  router.post('/bulk-complete', controller.bulkCompleteTasks);
  router.patch('/:id', controller.updateTask);
  router.delete('/:id', controller.deleteTask);
  return router;
}
