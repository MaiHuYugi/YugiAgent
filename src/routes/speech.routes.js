import { Router } from 'express';
import { createSpeech } from '../controllers/speech.controller.js';
import { requireUser } from '../middleware/auth.middleware.js';
import { requireJsonAction } from '../middleware/request.middleware.js';
import { speechLimiter } from '../middleware/security.middleware.js';

const router = Router();

router.post('/', speechLimiter, requireJsonAction, requireUser, createSpeech);

export default router;
