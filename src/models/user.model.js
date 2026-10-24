import mongoose from 'mongoose';

const encryptedSchema = new mongoose.Schema({
  iv: { type: String, required: true },
  tag: { type: String, required: true },
  ciphertext: { type: String, required: true }
}, { _id: false, versionKey: false });

const userSchema = new mongoose.Schema({
  // HMAC of Google's stable subject ID; raw Google identifiers and profile fields stay encrypted.
  googleIdHash: { type: String, required: true, unique: true, select: false },
  profile: { type: encryptedSchema, required: true, select: false },
  googleConnections: { type: Map, of: encryptedSchema, default: undefined, select: false },
  createdAt: { type: Date, default: Date.now, immutable: true },
  lastLoginAt: { type: Date, default: Date.now }
}, { versionKey: false, timestamps: false, strict: 'throw' });

export const User = mongoose.models.User || mongoose.model('User', userSchema);
