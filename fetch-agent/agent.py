import asyncio
import json
import logging
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from openai import OpenAI
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)


ROOT_ENV = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(ROOT_ENV)

api_key = os.getenv("ASI1_API_KEY") or os.getenv("ASI_ONE_API_KEY")
agent_seed = os.getenv("AGENT_SEED_PHRASE")
agent_api_key = os.getenv("YUGI_AGENT_API_KEY")
yugi_api_url = os.getenv("YUGI_API_URL", "http://localhost:3000").rstrip("/")

if not api_key:
    raise RuntimeError("Set ASI1_API_KEY or ASI_ONE_API_KEY in the project .env file.")
if not agent_seed:
    raise RuntimeError("Set AGENT_SEED_PHRASE in the project .env file.")

client = OpenAI(
    base_url=os.getenv("ASI1_BASE_URL", "https://api.asi1.ai/v1"),
    api_key=api_key,
    timeout=30.0,
    max_retries=1,
)

agent = Agent(
    name="yugi-guide",
    seed=agent_seed,
    port=8001,
    mailbox=True,
    publish_agent_details=True,
)
chat_protocol = Protocol(spec=chat_protocol_spec)

SYSTEM_PROMPT = """You are the Yugi Guide, a read-only product support agent for Yugi.
Yugi is a web chat assistant with Google sign-in, saved chats, text-to-speech,
and optional Google Workspace connections for Gmail, Calendar, Meet, and Drive.
This agent can issue a one-time account-pairing code when asked. Pairing alone
does not grant access by itself. After pairing, this agent can list the linked
user's Google Calendar events when they ask. It cannot read Gmail or Drive,
create events or Meet links, send email, or access Yugi chat history. Never
claim to have performed an action beyond the tool results. Ask the user to link
their account if Calendar access is unavailable. Answer questions about Yugi
and its setup clearly."""

WORKSPACE_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_calendar_events",
            "description": "Read the signed-in user's upcoming Google Calendar events or events in a specified time range. Use only when the user asks about their calendar or schedule. Requires the Yugi account to be linked and Google Calendar connected.",
            "parameters": {
                "type": "object",
                "properties": {
                    "timeMin": {"type": "string", "description": "Optional RFC3339 start time."},
                    "timeMax": {"type": "string", "description": "Optional RFC3339 end time."},
                },
                "additionalProperties": False,
            },
        },
    }
]


@chat_protocol.on_message(ChatMessage)
async def handle_message(ctx: Context, sender: str, message: ChatMessage):
    await ctx.send(
        sender,
        ChatAcknowledgement(acknowledged_msg_id=message.msg_id),
    )

    prompt = "\n".join(
        block.text for block in message.content if isinstance(block, TextContent)
    ).strip()
    if not prompt:
        return

    if len(prompt) > 5000:
        reply = "Please keep the question under 5,000 characters."
    elif is_account_link_request(prompt):
        if not agent_api_key:
            reply = "Account linking is not configured on this Yugi agent yet."
        else:
            try:
                result = await asyncio.to_thread(create_account_link_code, sender)
                reply = (
                    f"Your one-time Yugi account link code is: {result['code']}\n\n"
                    "While signed in to Yugi, open Connections and enter this code. "
                    "It expires in 10 minutes. Pairing alone does not enable Google actions; "
                    "it only associates this agent with your Yugi account."
                )
            except Exception:
                ctx.logger.exception("Yugi account-link request failed")
                reply = "I couldn't create a Yugi account-link code. Please try again later."
    else:
        try:
            reply = await answer_with_workspace_tools(sender, prompt)
        except Exception:
            ctx.logger.exception("ASI:One request failed")
            reply = "Yugi Guide is temporarily unavailable. Please try again later."

    await ctx.send(
        sender,
        ChatMessage(
            content=[
                TextContent(type="text", text=reply),
                EndSessionContent(type="end-session"),
            ]
        ),
    )


def is_account_link_request(prompt: str) -> bool:
    normalized = " ".join(prompt.lower().split())
    return any(phrase in normalized for phrase in (
        "link my yugi account",
        "link my account to yugi",
        "connect my yugi account",
        "pair my yugi account",
    ))


def create_account_link_code(agent_address: str) -> dict:
    request = Request(
        f"{yugi_api_url}/api/agent/links/start",
        data=json.dumps({"agentAddress": agent_address}).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Yugi-Agent-Key": agent_api_key},
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = json.loads(error.read().decode("utf-8") or "{}")
        raise RuntimeError(detail.get("error", "Yugi rejected the link request.")) from error
    except URLError as error:
        raise RuntimeError("Yugi could not be reached.") from error
    if not isinstance(result.get("code"), str):
        raise RuntimeError("Yugi did not return a pairing code.")
    return result


async def answer_with_workspace_tools(agent_address: str, prompt: str) -> str:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]
    for _ in range(3):
        completion = await asyncio.to_thread(
            client.chat.completions.create,
            model=os.getenv("ASI_ONE_MODEL", "asi1"),
            messages=messages,
            tools=WORKSPACE_TOOLS,
            tool_choice="auto",
            max_tokens=900,
        )
        assistant_message = completion.choices[0].message
        calls = assistant_message.tool_calls or []
        if not calls:
            return assistant_message.content or "I couldn't prepare a reply."

        messages.append(assistant_message.model_dump(exclude_none=True))
        for call in calls:
            if call.function.name != "list_calendar_events":
                result = {"error": "That Yugi workspace action is not available."}
            else:
                try:
                    arguments = json.loads(call.function.arguments or "{}")
                    result = await asyncio.to_thread(fetch_calendar_events, agent_address, arguments)
                except Exception as error:
                    result = {"error": str(error)}
            messages.append({
                "role": "tool",
                "tool_call_id": call.id,
                "content": json.dumps(result, ensure_ascii=False),
            })
    return "I couldn't finish the Calendar lookup. Please try asking with a shorter date range."


def fetch_calendar_events(agent_address: str, arguments: dict) -> dict:
    if not isinstance(arguments, dict) or set(arguments) - {"timeMin", "timeMax"}:
        raise ValueError("The Calendar request contained unsupported fields.")
    request = Request(
        f"{yugi_api_url}/api/agent/calendar/events",
        data=json.dumps({"agentAddress": agent_address, **arguments}).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Yugi-Agent-Key": agent_api_key or ""},
        method="POST",
    )
    try:
        with urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = json.loads(error.read().decode("utf-8") or "{}")
        raise RuntimeError(detail.get("error", "Yugi could not read Calendar events.")) from error
    except URLError as error:
        raise RuntimeError("Yugi could not be reached.") from error


@chat_protocol.on_message(ChatAcknowledgement)
async def handle_acknowledgement(_ctx: Context, _sender: str, _message: ChatAcknowledgement):
    return


agent.include(chat_protocol, publish_manifest=True)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    agent.run()
