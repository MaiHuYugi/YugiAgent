import 'dotenv/config';
import mongoose from 'mongoose';
import env from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { createApp } from './app.js';

let server;
try {
  await connectDatabase();
  const app = createApp(mongoose.connection.getClient());
  server = app.listen(env.port, () => {
    console.log(`Yugi is running at http://localhost:${env.port}`);
  });

  async function shutdown(signal) {
    console.log(`${signal} received; shutting down Yugi.`);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  }

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
} catch {
  console.error('Could not connect to MongoDB. Check MONGODB_URI and database network access.');
  process.exitCode = 1;
}
