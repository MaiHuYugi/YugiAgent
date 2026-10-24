import { createHash, randomBytes } from 'node:crypto';
import { AgentLink } from '../models/agent-link.model.js';

const AGENT_ADDRESS = /^agent1[a-z0-9]{20,90}$/;
const CODE_TTL_MS = 10 * 60 * 1000;

export async function startAgentLink(req, res) {
  const agentAddress = req.body?.agentAddress;
  if (typeof agentAddress !== 'string' || !AGENT_ADDRESS.test(agentAddress)) {
    return res.status(400).json({ error: 'A valid Fetch.ai agent address is required.' });
  }

  const existing = await AgentLink.findOne({ agentAddress }).select('+pairingCodeHash');
  if (existing?.userId) return res.status(409).json({ error: 'This agent is already linked to a Yugi account.' });

  const code = randomBytes(10).toString('base64url').toUpperCase();
  const pairingCodeHash = hashCode(code);
  await AgentLink.findOneAndUpdate(
    { agentAddress },
    { $set: { pairingCodeHash, pairingExpiresAt: new Date(Date.now() + CODE_TTL_MS) }, $setOnInsert: { agentAddress } },
    { upsert: true, new: true, runValidators: true }
  );
  res.set('Cache-Control', 'no-store');
  res.json({ code, expiresInSeconds: CODE_TTL_MS / 1000 });
}

export async function completeAgentLink(req, res) {
  const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  if (!/^[A-Z0-9_-]{12,20}$/.test(code)) return res.status(400).json({ error: 'Enter the pairing code shown by the Yugi agent.' });

  const link = await AgentLink.findOneAndUpdate(
    { pairingCodeHash: hashCode(code), pairingExpiresAt: { $gt: new Date() }, userId: { $exists: false } },
    { $set: { userId: req.user._id }, $unset: { pairingCodeHash: 1, pairingExpiresAt: 1 } },
    { new: true }
  ).select('agentAddress');
  if (!link) return res.status(400).json({ error: 'That code is invalid or expired. Request a new code from the Yugi agent.' });
  res.set('Cache-Control', 'no-store');
  res.json({ linked: true, agentAddress: link.agentAddress });
}

export async function getAgentLinks(req, res) {
  const links = await AgentLink.find({ userId: req.user._id }).select('agentAddress createdAt').lean();
  res.set('Cache-Control', 'no-store');
  res.json({ agents: links.map(({ agentAddress, createdAt }) => ({ agentAddress, createdAt })) });
}

export async function unlinkAgent(req, res) {
  const { agentAddress } = req.params;
  if (!AGENT_ADDRESS.test(agentAddress)) return res.status(400).json({ error: 'A valid Fetch.ai agent address is required.' });
  await AgentLink.deleteOne({ agentAddress, userId: req.user._id });
  res.status(204).end();
}

function hashCode(code) {
  return createHash('sha256').update(code).digest('hex');
}

