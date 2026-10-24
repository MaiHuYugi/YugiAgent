import session from 'express-session';
import MongoStore from 'connect-mongo';
import env from './env.js';

export function createSessionMiddleware(mongoClient) {
  return session({
    name: 'yugi.sid',
    secret: env.sessionSecret,
    store: MongoStore.create({
      client: mongoClient,
      collectionName: 'sessions',
      ttl: env.sessionMaxAgeMs / 1000,
      autoRemove: 'native'
    }),
    rolling: true,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: env.isProduction,
      sameSite: 'lax',
      maxAge: env.sessionMaxAgeMs
    }
  });
}
