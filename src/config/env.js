import 'dotenv/config';

const env = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGODB_URI?.trim(),
  asiOneApiKey: process.env.ASI_ONE_API_KEY?.trim(),
  agentApiKey: process.env.YUGI_AGENT_API_KEY?.trim(),
  asiOneModel: process.env.ASI_ONE_MODEL?.trim() || 'asi1',
  asiOnePlannerMode: process.env.ASI_ONE_PLANNER_MODE?.trim().toLowerCase() === 'true',
  asiOneAgentAddresses: (process.env.ASI_ONE_AGENT_ADDRESSES || '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean),
  openRouterApiKey: process.env.OPENROUTER_API_KEY?.trim(),
  openRouterTtsModel: process.env.OPENROUTER_TTS_MODEL?.trim() || 'fish-audio/s2.1-pro-free:free',
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim(),
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim(),
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL?.trim(),
  sessionSecret: process.env.SESSION_SECRET?.trim(),
  sessionMaxAgeMs: 365 * 24 * 60 * 60 * 1000
};

if (env.asiOneAgentAddresses.length > 10 || env.asiOneAgentAddresses.some((address) => !/^agent1[a-z0-9]{20,90}$/.test(address))) {
  throw new Error('ASI_ONE_AGENT_ADDRESSES must contain up to 10 comma-separated Fetch.ai agent addresses.');
}

const required = [
  ['MONGODB_URI', env.mongoUri],
  ['GOOGLE_CLIENT_ID', env.googleClientId],
  ['GOOGLE_CLIENT_SECRET', env.googleClientSecret],
  ['GOOGLE_CALLBACK_URL', env.googleCallbackUrl],
  ['SESSION_SECRET', env.sessionSecret]
];
const missing = required.filter(([, value]) => !value).map(([name]) => name);

if (missing.length) throw new Error(`Missing required .env settings: ${missing.join(', ')}`);
if (env.sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');

env.isProduction = env.nodeEnv === 'production';
Object.freeze(env);

export default env;
