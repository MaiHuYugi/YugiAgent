import env from '../config/env.js';

export function getHealth(_req, res) {
  res.json({ configured: Boolean(env.asiOneApiKey), provider: 'ASI:One' });
}
