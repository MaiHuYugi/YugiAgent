import { Router } from 'express';
import { beginGoogleSignIn, beginGoogleServiceConnect, completeGoogleSignIn } from '../controllers/auth.controller.js';
import { authLimiter } from '../middleware/security.middleware.js';

const router = Router();

router.get('/google', authLimiter, beginGoogleSignIn);
router.get('/google/connect/:service', authLimiter, beginGoogleServiceConnect);
router.get('/google/callback', authLimiter, completeGoogleSignIn);

export default router;
