import mongoose from 'mongoose';
import env from '../config/env.js';
import { User } from '../models/user.model.js';

export async function requireUser(req, res, next) {
  try {
    const userId = req.session?.userId;
    if (!userId || !mongoose.isValidObjectId(userId)) {
      return res.status(401).json({ error: 'Please sign in with Google to continue.', signInRequired: true });
    }

    const user = await User.findById(userId).select('+profile');
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Please sign in with Google to continue.', signInRequired: true });
    }

    req.user = user;
    next();
  } catch {
    res.status(503).json({ error: 'Account storage is temporarily unavailable.' });
  }
}

export function extendSignedInSession(req, _res, next) {
  if (req.session?.userId) req.session.cookie.maxAge = env.sessionMaxAgeMs;
  next();
}
