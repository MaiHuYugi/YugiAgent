# Yugi

Yugi is a plain HTML, CSS, and JavaScript frontend served by a Node.js and Express backend, with Google sign-in, MongoDB conversation storage, and ASI:One text chat.

## Run locally

1. Add the required values to `.env` (see `.env.example`).
2. Install dependencies with `npm install`.
3. Start the app with `npm run dev`.
4. Open `http://localhost:3000`.

ASI:One is the only chat provider. Add `ASI_ONE_API_KEY`; `ASI_ONE_MODEL` defaults to `asi1`. To enable ASI:One Planner Mode, set `ASI_ONE_PLANNER_MODE=true`. Planner Mode can discover and contact third-party agents in Agentverse, so it is off by default. Optionally set `ASI_ONE_AGENT_ADDRESSES` to a comma-separated list of preferred Agentverse agent addresses.

Planner clarification sessions are encrypted in the conversation and can be resumed for 15 minutes. Yugi does not approve or process Agentverse payment requests or interactive cards. If a planner run is interrupted before its result is known, Yugi will not automatically retry it.

An optional Fetch.ai uAgent is in [`fetch-agent/`](fetch-agent/README.md). It uses ACP and an Agentverse mailbox, can be paired with a signed-in Yugi account, and can read that account's Google Calendar after the user connects Calendar. Gmail, Drive, and Google write actions are not enabled through the uAgent yet.

The static frontend lives in `public/`. The landing page is at `/`, the chat is at `/cli`, and Google connections are at `/connections`.

Image generation is marked as coming soon in the CLI. Assistant replies have an on-demand **Listen** control powered by OpenRouter; set `OPENROUTER_API_KEY` and optionally `OPENROUTER_TTS_MODEL` (`fish-audio/s2.1-pro-free:free` by default).

## Backend layout

```text
server.js                 Entry point
src/
  app.js                  Express setup and route mounting
  server.js               Database connection and HTTP lifecycle
  config/                 Environment, MongoDB, Google OAuth, sessions
  middleware/             Authentication, request checks, security, errors
  models/                 Mongoose schemas and indexes
  routes/                 HTTP method and URL declarations
  controllers/            HTTP request and response handling
  services/               OAuth, encryption, conversations, LLM providers, OpenRouter speech
  prompts/                Yugi system prompt
public/                   Static HTML, CSS, JavaScript, and image assets
```

## Adding a backend feature

Put persistence and provider logic in a service, HTTP handling in a controller, then expose it through a router under `src/routes/`. Mount the router in `src/app.js`. Keep credentials and data access on the server.

## Google Workspace connections

Sign in to Yugi, open the **Connections** page, and link Calendar, Meet, Gmail, or Drive separately. Each connection uses its own OAuth consent step. Google OAuth credentials must allow the callback URI in `GOOGLE_CALLBACK_URL`; sensitive scopes can require Google OAuth consent-screen verification before general release. Meet links are created through Calendar event conference data, so the Meet connection uses the Calendar events scope.

Connection tokens are encrypted with `DATA_ENCRYPTION_KEY` in the user's `googleConnections` map and are never returned by the account API. Disconnecting removes the stored connection from Yugi. Chat first filters the catalog to linked Google services, uses an LLM router to semantically select relevant tools, and supplies only those tool schemas to the planner. Read tools cover Gmail search, Drive file search, Calendar listing, and availability. Users can add a Calendar event from chat with optional attendees and an optional Meet link after explicit confirmation. They can also create a standalone Google Meet space after explicit confirmation. Gmail can prepare and send plain-text email through a Gmail draft after a separate explicit confirmation of the recipients, subject, and full body. Pending actions are encrypted and expire after 15 minutes. Tool arguments and recipient evidence are validated, calls are capped, and API responses are checked before reporting success. Drive changes are not yet available.
