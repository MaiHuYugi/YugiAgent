import mongoose from 'mongoose';
import {
  deleteUserConversation,
  getUserConversation,
  listUserConversations
} from '../services/conversation.service.js';

export async function listConversations(req, res) {
  try {
    const conversations = await listUserConversations(req.user._id);
    res.set('Cache-Control', 'no-store');
    res.json({ conversations });
  } catch {
    res.status(503).json({ error: 'Conversation storage is temporarily unavailable.' });
  }
}

export async function getConversation(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Conversation not found.' });
  try {
    const conversation = await getUserConversation(req.user._id, req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });
    res.set('Cache-Control', 'no-store');
    res.json({ conversation });
  } catch {
    res.status(503).json({ error: 'Conversation storage is temporarily unavailable.' });
  }
}

export async function deleteConversation(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Conversation not found.' });
  try {
    const deleted = await deleteUserConversation(req.user._id, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Conversation not found.' });
    res.status(204).end();
  } catch {
    res.status(503).json({ error: 'Conversation storage is temporarily unavailable.' });
  }
}
