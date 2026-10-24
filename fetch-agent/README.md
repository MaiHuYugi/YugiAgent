# Yugi Guide uAgent

This uAgent exposes product help for Yugi using Fetch.ai's Agent Chat Protocol.
After a user pairs it with their Yugi account and connects Google Calendar, it
can read that user's Calendar events. It does not access Gmail, Drive, or chat
history, and it cannot create events or send email.

## Run locally

The agent reads `AGENT_SEED_PHRASE`, `YUGI_AGENT_API_KEY`, and either
`ASI1_API_KEY` or the existing `ASI_ONE_API_KEY` from the project root `.env`
file. Keep all secrets private; `.env` is ignored by Git.

From this directory in PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Add these settings to the project root `.env`:

```dotenv
AGENT_SEED_PHRASE=use-a-long-private-seed-phrase
ASI1_API_KEY=your-asi-one-api-key
YUGI_AGENT_API_KEY=your-private-yugi-agent-api-key
YUGI_API_URL=http://localhost:3000
```

Then start the agent from the project root:

```powershell
py fetch-agent\agent.py
```

The process must stay online to answer messages. It connects to Agentverse with
mailbox enabled, so an inbound public web endpoint is not needed. Use the
Agentverse Inspector URL printed at startup, connect the agent's mailbox, then
review its profile and test the ACP chat protocol. Keep the same seed across
restarts so the agent identity remains stable.

To pair this agent with a signed-in Yugi account, ask it in ASI:One to "link my
Yugi account". Enter the one-time code on Yugi's Connections page while signed
in. The code expires after 10 minutes. The agent address is then associated with
that Yugi account until the user unlinks it from Connections. When the agent is
hosted remotely, set `YUGI_API_URL` to the public Yugi server URL and store
`YUGI_AGENT_API_KEY` in the host's secret settings.

The agent sends ordinary questions to ASI:One as standalone requests; it does
not store cross-session conversation history. Account linking and read-only
Calendar lookup are implemented. Gmail, Drive, and Google write actions through
this agent are not yet enabled.

## Use this agent from Yugi chat

After the agent starts, copy its `agent1...` address from the startup log and
add it to the root `.env`:

```dotenv
ASI_ONE_PLANNER_MODE=true
# Copy the real agent1... address from the agent startup log.
ASI_ONE_AGENT_ADDRESSES=
```

Restart Yugi's Node server. Planner Mode can then consider this agent for chat
requests while still discovering other Agentverse agents when useful. The
agent address setting is only sent with ASI:One planner requests.
