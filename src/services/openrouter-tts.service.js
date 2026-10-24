import env from '../config/env.js';

export async function synthesizeSpeech(input) {
  if (!env.openRouterApiKey) {
    const error = new Error('Speech is not configured. Add OPENROUTER_API_KEY to .env.');
    error.statusCode = 503;
    throw error;
  }

  let response;
  try {
    response = await fetch('https://openrouter.ai/api/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.openRouterApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: env.openRouterTtsModel,
        input,
        response_format: 'mp3'
      }),
      signal: AbortSignal.timeout(90_000)
    });
  } catch (cause) {
    const error = new Error(cause?.name === 'TimeoutError'
      ? 'Speech generation took too long. Please try again.'
      : 'The server could not connect to OpenRouter for speech generation.');
    error.statusCode = 502;
    error.cause = cause;
    throw error;
  }

  if (!response.ok) {
    let providerMessage = '';
    try {
      const body = await response.json();
      providerMessage = typeof body.error?.message === 'string' ? body.error.message.trim().slice(0, 180) : '';
    } catch (_) { /* Keep the status-based message when the provider body is not JSON. */ }

    const causes = {
      401: 'OpenRouter rejected the API key. Check OPENROUTER_API_KEY in .env.',
      402: 'OpenRouter reports insufficient account credits.',
      404: 'OpenRouter could not find the configured speech model. Check OPENROUTER_TTS_MODEL.',
      429: 'OpenRouter rate-limited speech generation. Wait a moment and try again.'
    };
    const error = new Error(causes[response.status] || `Speech generation failed at OpenRouter (HTTP ${response.status}).${providerMessage ? ` ${providerMessage}` : ''}`);
    error.statusCode = 502;
    error.providerStatus = response.status;
    throw error;
  }

  const contentType = response.headers.get('content-type')?.split(';')[0].toLowerCase();
  if (contentType !== 'audio/mpeg' && contentType !== 'audio/mp3') {
    const error = new Error(`OpenRouter returned an unsupported speech format (${contentType || 'unknown'}).`);
    error.statusCode = 502;
    throw error;
  }

  return Buffer.from(await response.arrayBuffer());
}
