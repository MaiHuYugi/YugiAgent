import mongoose from 'mongoose';
import env from './env.js';
import { User } from '../models/user.model.js';
import { Conversation } from '../models/conversation.model.js';

export async function connectDatabase() {
  await mongoose.connect(env.mongoUri, {
    autoIndex: true,
    serverSelectionTimeoutMS: 10000
  });
  await Promise.all([User.init(), Conversation.init()]);
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
