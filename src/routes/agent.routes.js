import { Router } from 'express';
import { startAgentLink } from '../controllers/agent-link.controller.js';
import { getAgentCalendarEvents } from '../controllers/agent-workspace.controller.js';
import { requireAgentApiKey } from '../middleware/agent-auth.middleware.js';
import { accountLimiter } from '../middleware/security.middleware.js';

const router = Router();
router.post('/links/start', accountLimiter, requireAgentApiKey, startAgentLink);
router.post('/calendar/events', accountLimiter, requireAgentApiKey, getAgentCalendarEvents);

export default router;
