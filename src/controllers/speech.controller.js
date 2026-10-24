import { synthesizeSpeech } from '../services/openrouter-tts.service.js';

export async function createSpeech(req, res) {
  const { text } = req.body ?? {};
  if (typeof text !== 'string' || !text.trim() || text.length > 8000) {
    return res.status(400).json({ error: 'Speech text must contain 1 to 8,000 characters.' });
  }

  try {
    const audio = await synthesizeSpeech(text.trim());
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(audio.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.send(audio);
  } catch (error) {
    console.error('Speech generation failed:', error?.providerStatus || error?.name || error?.statusCode || 'request error');
    res.status(error?.statusCode || 502).json({ error: error?.message || 'Speech generation failed.' });
  }
}
