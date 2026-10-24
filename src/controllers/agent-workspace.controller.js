import { AgentLink } from '../models/agent-link.model.js';
import { listCalendarEvents } from '../services/google-workspace.service.js';

const AGENT_ADDRESS = /^agent1[a-z0-9]{20,90}$/;

export async function getAgentCalendarEvents(req, res) {
  const { agentAddress, timeMin, timeMax } = req.body || {};
  if (typeof agentAddress !== 'string' || !AGENT_ADDRESS.test(agentAddress)) {
    return res.status(400).json({ error: 'A valid Fetch.ai agent address is required.' });
  }
  if (timeMin !== undefined && (typeof timeMin !== 'string' || Number.isNaN(Date.parse(timeMin)))) {
    return res.status(400).json({ error: 'The calendar start time must be a valid date.' });
  }
  if (timeMax !== undefined && (typeof timeMax !== 'string' || Number.isNaN(Date.parse(timeMax)))) {
    return res.status(400).json({ error: 'The calendar end time must be a valid date.' });
  }
  if (timeMin && timeMax && Date.parse(timeMax) <= Date.parse(timeMin)) {
    return res.status(400).json({ error: 'The calendar end time must be after the start time.' });
  }

  const link = await AgentLink.findOne({ agentAddress, userId: { $exists: true } }).select('userId').lean();
  if (!link) return res.status(403).json({ error: 'Link this agent to your Yugi account from the Connections page first.' });

  try {
    const events = await listCalendarEvents(link.userId, { timeMin, timeMax });
    res.set('Cache-Control', 'no-store');
    res.json({ events });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Google Calendar could not return events.' });
  }
}
