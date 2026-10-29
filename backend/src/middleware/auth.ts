import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export const COOKIE = 'ri_token';

export interface AuthedRequest extends Request {
  userId: string;
}

export const signSession = (userId: string) => jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '7d' });

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string };
    (req as AuthedRequest).userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid session' });
  }
}
