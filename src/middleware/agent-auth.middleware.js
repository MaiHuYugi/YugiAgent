import { timingSafeEqual } from 'node:crypto';
import env from '../config/env.js';

export function requireAgentApiKey(req, res, next) {
  const provided = req.get('X-Yugi-Agent-Key') || '';
  const expected = env.agentApiKey || '';
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (!expectedBytes.length || providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) {
    return res.status(expectedBytes.length ? 401 : 503).json({ error: 'Agent service is not configured.' });
  }
  next();
}
