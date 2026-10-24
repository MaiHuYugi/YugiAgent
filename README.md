# Yugi

## What it does

Yugi is an AI chat app. Sign in with Google to save conversations and connect Google Calendar, Meet, Gmail, and Drive for supported tasks in chat. It can also read replies aloud.

## What it uses

- Node.js, Express, and a browser-based HTML, CSS, and JavaScript interface
- MongoDB for accounts and saved conversations
- Google OAuth for sign-in and Google Workspace connections
- ASI:One for chat (`ASI_ONE_API_KEY`)
- OpenRouter for text-to-speech (`OPENROUTER_API_KEY`, optional)
- Fetch.ai uAgent for the optional agent in `fetch-agent/`

## How to run

1. Install Node.js.
2. Copy `.env.example` to `.env` and set `MONGODB_URI`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, and a `SESSION_SECRET` of at least 32 characters. Set `ASI_ONE_API_KEY` to enable chat. Configure the Google OAuth callback as `http://localhost:3000/auth/google/callback`.
3. Install dependencies and start the app:

   ```powershell
   npm install
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

5. Google Workspace connections
Sign in to Yugi, open the Connections page, and link Calendar, Meet, Gmail, or Drive separately. Each connection uses its own OAuth consent step. Google OAuth credentials must allow the callback URI in GOOGLE_CALLBACK_URL; sensitive scopes can require Google OAuth consent-screen verification before general release. Meet links are created through Calendar event conference data, so the Meet connection uses the Calendar events scope.

Connection tokens are encrypted with DATA_ENCRYPTION_KEY in the user's googleConnections map and are never returned by the account API. Disconnecting removes the stored connection from Yugi. Chat first filters the catalog to linked Google services, uses an LLM router to semantically select relevant tools, and supplies only those tool schemas to the planner. Read tools cover Gmail search, Drive file search, Calendar listing, and availability. Users can add a Calendar event from chat with optional attendees and an optional Meet link after explicit confirmation. They can also create a standalone Google Meet space after explicit confirmation. Gmail can prepare and send plain-text email through a Gmail draft after a separate explicit confirmation of the recipients, subject, and full body. Pending actions are encrypted and expire after 15 minutes. Tool arguments and recipient evidence are validated, calls are capped, and API responses are checked before reporting success. Drive changes are not yet available.