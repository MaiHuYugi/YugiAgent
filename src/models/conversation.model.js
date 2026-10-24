import mongoose from 'mongoose';

const encryptedSchema = new mongoose.Schema({
  iv: { type: String, required: true },
  tag: { type: String, required: true },
  ciphertext: { type: String, required: true }
}, { _id: false, versionKey: false });

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: encryptedSchema,
     required: true },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false, strict: 'throw' });

const conversationSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  title: { type: encryptedSchema, required: true },
  messages: { type: [messageSchema], default: [] },
  pendingAction: { type: encryptedSchema, default: undefined },
  pendingPlanner: { type: encryptedSchema, default: undefined },
  pendingWorkflow: { type: encryptedSchema, default: undefined },
  createdAt: { type: Date, default: Date.now, immutable: true },
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false, strict: 'throw' });

conversationSchema.index({ owner: 1, updatedAt: -1 });

export const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);
