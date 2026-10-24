import { Router } from 'express';
import { deleteAccount, disconnectGoogleService, getCurrentUser, getGoogleConnections, signOut } from '../controllers/account.controller.js';
import { completeAgentLink, getAgentLinks, unlinkAgent } from '../controllers/agent-link.controller.js';
import { requireUser } from '../middleware/auth.middleware.js';
import { requireJsonAction } from '../middleware/request.middleware.js';
import { accountLimiter } from '../middleware/security.middleware.js';

const router = Router();

router.get('/auth/me', getCurrentUser);
router.get('/google/connections', requireUser, getGoogleConnections);
router.get('/agent/links', requireUser, getAgentLinks);
router.post('/agent/links', requireJsonAction, requireUser, completeAgentLink);
router.delete('/agent/links/:agentAddress', requireJsonAction, requireUser, unlinkAgent);
router.delete('/google/connections/:service', requireJsonAction, requireUser, disconnectGoogleService);
router.post('/auth/logout', requireJsonAction, requireUser, signOut);
router.delete('/account', accountLimiter, requireJsonAction, requireUser, deleteAccount);

export default router;
