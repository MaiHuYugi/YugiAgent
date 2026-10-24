import { decryptText } from '../services/encryption.service.js';
import { User } from '../models/user.model.js';
import { deleteAllUserConversations } from '../services/conversation.service.js';
import { AgentLink } from '../models/agent-link.model.js';

export async function getCurrentUser(req, res) {
  const userId = req.session?.userId;
  if (!userId) return res.json({ authenticated: false });

  try {
    const user = await User.findById(userId).select('+profile');
    if (!user) return res.json({ authenticated: false });
    const profile = JSON.parse(decryptText(user.profile));
    const name = profile.name && profile.name !== 'Yugi user'
      ? profile.name
      : (profile.email?.split('@')[0] || 'Yugi user');
    res.set('Cache-Control', 'no-store');
    res.json({ authenticated: true, user: { name, email: profile.email, picture: profile.picture } });
  } catch {
    res.status(503).json({ error: 'Account storage is temporarily unavailable.' });
  }
}

export async function getGoogleConnections(req, res) {
  const user = await User.findById(req.user._id).select('+googleConnections');
  const connections = {};
  for (const [service, payload] of user?.googleConnections || []) {
    try { connections[service] = { connected: true, email: JSON.parse(decryptText(payload)).email || null }; }
    catch { connections[service] = { connected: false, email: null }; }
  }
  res.set('Cache-Control', 'no-store');
  res.json({ connections });
}

export async function disconnectGoogleService(req, res) {
  const { service } = req.params;
  if (!['calendar', 'meet', 'gmail', 'drive'].includes(service)) return res.status(404).json({ error: 'Unknown Google service.' });
  const user = await User.findById(req.user._id).select('+googleConnections');
  if (user?.googleConnections) {
    user.googleConnections.delete(service);
    await user.save();
  }
  res.status(204).end();
}

export function signOut(req, res) {
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ error: 'Could not sign out. Please try again.' });
    clearSessionCookie(res);
    res.status(204).end();
  });
}

export async function deleteAccount(req, res) {
  try {
    await deleteAllUserConversations(req.user._id);
    await AgentLink.deleteMany({ userId: req.user._id });
    await User.deleteOne({ _id: req.user._id });
    req.session.destroy((error) => {
      if (error) return res.status(500).json({ error: 'Account data was removed, but sign-out failed.' });
      clearSessionCookie(res);
      res.status(204).end();
    });
  } catch {
    res.status(503).json({ error: 'Account data could not be removed. Please try again.' });
  }
}

function clearSessionCookie(res) {
  res.clearCookie('yugi.sid', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
}
