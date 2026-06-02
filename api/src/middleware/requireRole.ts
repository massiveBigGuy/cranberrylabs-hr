import type { Request, Response, NextFunction } from 'express';

const RANK: Record<string, number> = { viewer: 0, user: 1, admin: 2 };

export function requireRole(min: 'viewer' | 'user' | 'admin') {
  return function checkRole(req: Request, res: Response, next: NextFunction): void {
    const role = req.user?.role;
    if (!role || (RANK[role] ?? -1) < RANK[min]) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}
