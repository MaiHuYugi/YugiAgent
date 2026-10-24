import { randomUUID } from 'node:crypto';
import env from '../config/env.js';
import yugiSystemPrompt from '../prompts/yugi-system.prompt.js';

const ASI_ONE_URL = 'https://api.asi1.ai/v1/chat/completions';

export async function createTextStream(messages, context = '', { plannerMode = env.asiOnePlannerMode, plannerSessionId = null } = {}) {
  assertProviderConfigured();
  const conversationMessages = withSystemMessage(messages, context);

  const usePlannerMode = Boolean(plannerMode && env.asiOnePlannerMode);
  const sessionId = usePlannerMode ? plannerSessionId || randomUUID() : null;
  const stream = streamAsiOneCompletion({
    model: env.asiOneModel,
    messages: conversationMessages,
    temperature: 0.6,
    max_tokens: 2048,
    ...(usePlannerMode ? { planner_mode: true } : {}),
    ...(usePlannerMode && env.asiOneAgentAddresses.length
      ? { agents: env.asiOneAgentAddresses }
      : {}),
    stream: true
  }, usePlannerMode ? 420_000 : 30_000, sessionId);
  return { stream, plannerSessionId: sessionId, plannerMode: usePlannerMode };
}

export async function createToolPlan(messages, tools, context = '', requiredToolName = null) {
  assertProviderConfigured();
  const payload = {
    model: env.asiOneModel,
    messages: withSystemMessage(messages, context),
    tools,
    tool_choice: requiredToolName
      ? { type: 'function', function: { name: requiredToolName } }
      : 'auto',
    temperature: 0.2,
    stream: false
  };

  const result = await requestAsiOneCompletion({ ...payload, max_tokens: 1000 }, 15_000);
  return result.choices?.[0]?.message;
}

export async function discoverWorkspaceTools(request, catalog, context = '') {
  if (!catalog.length) return [];
  assertProviderConfigured();
  const toolNames = catalog.map((tool) => tool.name);
  const tools = [{ type: 'function', function: {
    name: 'select_workspace_tools',
    description: 'Choose the relevant connected Google Workspace tools for this request.',
    parameters: { type: 'object', properties: { toolNames: { type: 'array', items: { type: 'string', enum: toolNames }, maxItems: toolNames.length } }, required: ['toolNames'], additionalProperties: false }
  } }];
  const payload = {
    model: env.asiOneModel,
    messages: [
      { role: 'system', content: `You are a Google Workspace tool-discovery router. Read the user's intent semantically, including synonyms and implied data types. Select only tools needed to answer or carry out the request. Return an empty list for unrelated requests or actions that no listed tool supports. Never infer a tool from a coincidental keyword. Connected services and timezone: ${context}` },
      { role: 'user', content: JSON.stringify({ request, availableTools: catalog }) }
    ],
    tools,
    tool_choice: { type: 'function', function: { name: 'select_workspace_tools' } },
    temperature: 0,
    stream: false
  };

  const result = await requestAsiOneCompletion({ ...payload, max_tokens: 300 }, 12_000);

  const call = result.choices?.[0]?.message?.tool_calls?.find((item) => item.function?.name === 'select_workspace_tools');
  if (!call) return [];
  try {
    const selected = JSON.parse(call.function.arguments || '{}').toolNames;
    if (!Array.isArray(selected)) return [];
    return [...new Set(selected)].filter((name) => toolNames.includes(name));
  } catch { return []; }
}

function withSystemMessage(messages, context) {
  const system = context ? `${yugiSystemPrompt}\n\nCurrent request context:\n${context}` : yugiSystemPrompt;
  return [{ role: 'system', content: system }, ...messages];
}

function assertProviderConfigured() {
  if (env.asiOneApiKey) return;
  const error = new Error('ASI:One is not configured. Add ASI_ONE_API_KEY to .env and restart the server.');
  error.statusCode = 503;
  error.status = 503;
  error.provider = 'ASI:One';
  throw error;
}

async function requestAsiOneCompletion(payload, timeoutMs) {
  const response = await requestAsiOne(payload, timeoutMs);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw createAsiOneError(result, response.status);
  return result;
}

async function requestAsiOne(payload, timeoutMs, sessionId = null) {
  let response;
  try {
    response = await fetch(ASI_ONE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.asiOneApiKey}`,
        'Content-Type': 'application/json',
        ...(sessionId ? { 'x-session-id': sessionId } : {})
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (cause) {
    const error = new Error(cause?.name === 'TimeoutError' ? 'ASI:One timed out. Please try again.' : 'The server could not connect to ASI:One.');
    error.statusCode = 502;
    error.status = 502;
    error.provider = 'ASI:One';
    error.cause = cause;
    throw error;
  }
  return response;
}

async function* streamAsiOneCompletion(payload, timeoutMs, sessionId = null) {
  const response = await requestAsiOne(payload, timeoutMs, sessionId);
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw createAsiOneError(result, response.status);
  }
  if (!response.body) throw createAsiOneError({ error: { message: 'ASI:One returned an empty response stream.' } }, 502);

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseAsiOneEvent(frame);
      if (parsed === 'done') return;
      if (parsed) yield parsed;
    }
  }
  buffer += decoder.decode();
  buffer = buffer.replace(/\r\n/g, '\n');
  if (buffer.trim()) {
    const parsed = parseAsiOneEvent(buffer);
    if (parsed && parsed !== 'done') yield parsed;
  }
}

function parseAsiOneEvent(frame) {
  const data = frame.split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (!data) return null;
  if (data === '[DONE]') return 'done';
  let result;
  try { result = JSON.parse(data); }
  catch {
    const error = new Error('ASI:One returned an invalid streaming response.');
    error.statusCode = 502;
    error.status = 502;
    error.provider = 'ASI:One';
    throw error;
  }
  if (result.error) throw createAsiOneError(result, result.error.status || 502);
  return result;
}

function createAsiOneError(payload, status) {
  const message = payload?.error?.message || payload?.message || `ASI:One request failed (${status}).`;
  const error = new Error(message);
  error.statusCode = status;
  error.status = status;
  error.provider = 'ASI:One';
  return error;
}

