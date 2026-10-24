import { Router } from 'express';
import {
  deleteConversation,
  getConversation,
  listConversations
} from '../controllers/conversation.controller.js';
import { requireUser } from '../middleware/auth.middleware.js';
import { requireJsonAction } from '../middleware/request.middleware.js';
import { accountLimiter } from '../middleware/security.middleware.js';

const router = Router();

router.use(requireUser);
router.get('/', listConversations);
router.get('/:id', getConversation);
router.delete('/:id', accountLimiter, requireJsonAction, deleteConversation);

export default router;
