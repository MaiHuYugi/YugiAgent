import mongoose from 'mongoose';

const agentLinkSchema = new mongoose.Schema({
  agentAddress: { type: String, required: true, unique: true, immutable: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  pairingCodeHash: { type: String, unique: true, sparse: true, select: false },
  pairingExpiresAt: { type: Date, index: { expires: 0 }, select: false },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false, strict: 'throw' });

export const AgentLink = mongoose.models.AgentLink || mongoose.model('AgentLink', agentLinkSchema);
