import { Router } from 'express';
import type { AppContext } from '../types';
import { UsersRepo, isUserRole } from './repo';
import { requireRole } from '../../middleware/requireRole';

export function buildUsersRouter(ctx: AppContext): Router {
  const router = Router();
  const users = new UsersRepo(ctx.db);

  // GET /api/users/me — current user's profile + role
  // Must be registered before /:username to prevent wildcard swallowing it.
  router.get('/me', (req, res) => {
    const user = users.get(req.user!.username);
    if (!user) {
      res.status(404).json({ error: 'user not found' });
      return;
    }
    res.json({ user });
  });

  // GET /api/users — admin only; list all users + roles
  router.get('/', requireRole('admin'), (_req, res) => {
    res.json({ users: users.list() });
  });

  // PATCH /api/users/:username/role — admin only; assign role
  router.patch('/:username/role', requireRole('admin'), (req, res) => {
    const username = String(req.params.username);
    const { role } = req.body ?? {};
    if (!isUserRole(role)) {
      res.status(400).json({ error: 'role must be admin, user, or viewer' });
      return;
    }
    if (username === req.user!.username && role !== 'admin') {
      res.status(400).json({ error: 'cannot change your own role' });
      return;
    }
    const updated = users.updateRole(username, role);
    if (!updated) {
      res.status(404).json({ error: 'user not found' });
      return;
    }
    res.json({ user: updated });
  });

  return router;
}
