import type { Request, Response, NextFunction } from 'express';
import type { AppConfig } from '../config';

export interface AutheliaUser {
  username: string;
  email?: string;
  name?: string;
  groups: string[];
  role?: string;  // populated by userProvisioner middleware
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AutheliaUser;
    }
  }
}

/**
 * Per §13: the proxy strips any client-supplied Remote-* headers and replaces
 * them with values from Authelia after a successful auth check. The API
 * trusts those headers and rejects requests missing them — which can only
 * happen if someone bypassed the proxy. The schema warns: the API must only
 * be reachable via the proxy. Binding to localhost / docker-internal handles
 * that at the network level; this middleware is the application-level
 * backstop.
 */
export function makeAutheliaIdentity(config: AppConfig) {
  const bypassUser = config.auth.dev_bypass_user;

  return function autheliaIdentity(req: Request, res: Response, next: NextFunction): void {
    const user = req.header('Remote-User');

    if (!user) {
      if (bypassUser) {
        req.user = { username: bypassUser, groups: [] };
        return next();
      }
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    req.user = {
      username: user,
      email: req.header('Remote-Email'),
      name: req.header('Remote-Name'),
      groups: (req.header('Remote-Groups') ?? '').split(',').filter(Boolean),
    };
    next();
  };
}
