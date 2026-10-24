import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import env from './config/env.js';
import { createSessionMiddleware } from './config/session.js';
import { extendSignedInSession } from './middleware/auth.middleware.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { securityHeaders } from './middleware/security.middleware.js';
import accountRoutes from './routes/account.routes.js';
import agentRoutes from './routes/agent.routes.js';
import authRoutes from './routes/auth.routes.js';
import chatRoutes from './routes/chat.routes.js';
import conversationRoutes from './routes/conversation.routes.js';
import healthRoutes from './routes/health.routes.js';
import speechRoutes from './routes/speech.routes.js';

const appDirectory = path.dirname(fileURLToPath(import.meta.url));

export function createApp(mongoClient) {
  const app = express();
  app.disable('x-powered-by');
  if (env.isProduction) app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(express.json({ limit: '64kb' }));
  app.use(createSessionMiddleware(mongoClient));
  app.use(extendSignedInSession);
  app.get(['/', '/index.html'], (_req, res) => res.sendFile(path.join(appDirectory, '../public/index.html')));
  app.get(['/cli', '/cli.html'], (_req, res) => res.sendFile(path.join(appDirectory, '../public/cli.html')));
  app.get(['/connections', '/integrations.html'], (_req, res) => res.sendFile(path.join(appDirectory, '../public/connections.html')));
  app.use('/images', express.static(path.join(appDirectory, 'img'), {
    dotfiles: 'deny',
    maxAge: env.isProduction ? '1h' : 0
  }));
  app.use(express.static(path.join(appDirectory, '../public'), {
    dotfiles: 'deny',
    index: false,
    maxAge: env.isProduction ? '1h' : 0
  }));

  app.use('/auth', authRoutes);
  app.use('/api', accountRoutes);
  app.use('/api/agent', agentRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/tts', speechRoutes);
  app.use('/api/conversations', conversationRoutes);
  app.use('/api/health', healthRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
