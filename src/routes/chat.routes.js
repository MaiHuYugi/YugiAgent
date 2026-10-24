import { Router } from 'express';
import { streamChatReply } from '../controllers/chat.controller.js';
import { requireUser } from '../middleware/auth.middleware.js';
import { requireJsonAction } from '../middleware/request.middleware.js';
import { chatLimiter } from '../middleware/security.middleware.js';

const router = Router();

router.post('/', chatLimiter, requireJsonAction, requireUser, streamChatReply);

export default router;
