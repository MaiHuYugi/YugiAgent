import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import env from '../config/env.js';
import { clearPendingAction, saveAssistantReply, savePendingPlannerSession, startConversationTurn } from '../services/conversation.service.js';
import { createTextStream, createToolPlan, discoverWorkspaceTools } from '../services/asi1.service.js';
import { executeConfirmedAction, executeToolCall, getConnectedToolCatalog, getRelevantToolSchemas } from '../services/tool-registry.service.js';
import { User } from '../models/user.model.js';
import { decryptText } from '../services/encryption.service.js';

export async function streamChatReply(req, res) {
  const { message, conversationId } = req.body ?? {};
  if (typeof message !== 'string' || !message.trim() || message.length > 10000) {
    return res.status(400).json({ error: 'Send a message containing 1 to 10,000 characters.' });
  }
  if (conversationId && !mongoose.isValidObjectId(conversationId)) {
    return res.status(404).json({ error: 'Conversation not found.' });
  }
  let timezone = typeof req.body?.timezone === 'string' && req.body.timezone.length <= 64 ? req.body.timezone : 'Asia/Kolkata';
  if (timezone === 'Asia/Calcutta') timezone = 'Asia/Kolkata';
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { timezone = 'Asia/Kolkata'; }

  let stream;
  let conversation;
  let pendingActionToSave;
  let pendingPlannerToSave = null;
  let pendingWorkflowToSave = null;
  let plannerSessionIdForTurn = null;
  let plannerModeForStream = false;
  let plannerStatus = null;
  let lastPlannerProgress = null;
  let directAssistantReply = '';
  try {
    const turn = await startConversationTurn(req.user._id, conversationId, message.trim());
    if (!turn) return res.status(404).json({ error: 'Conversation not found.' });
    conversation = turn.conversation;
    const plannerModeEnabled = env.asiOnePlannerMode;
    const available = await User.findById(req.user._id).select('+googleConnections');
    const connectedServices = new Set();
    for (const [service, encrypted] of available?.googleConnections || []) {
      try { JSON.parse(decryptText(encrypted)); connectedServices.add(service); } catch { /* Corrupt connection is omitted from tool discovery. */ }
    }
    let modelMessages = turn.modelMessages;
    let context = `User timezone: ${timezone}. Connected Google services: ${[...connectedServices].join(', ') || 'none'}. Only report Workspace information present in actual API results. Do not invent meeting dates, times, durations, attendee email addresses, or email recipients. Calendar events require exact dates, times, and timezone; attendees are optional, and a Google Meet link is added only when requested. Creating a standalone Google Meet space after the user explicitly asks happens immediately without another confirmation. Creating a Calendar event requires a separate explicit user confirmation. Sending an email requires a separate, explicit user confirmation after showing the exact recipient fields, subject, and complete body. A requested or proposed action is not complete until the Google API confirms it.`;
    let skipDiscovery = false;
    if (turn.pendingPlanner) {
      pendingPlannerToSave = null;
      if (turn.pendingPlanner.status === 'in_progress') {
        directAssistantReply = 'The previous Agentverse run ended before Yugi could confirm its outcome, so I did not resume it. Check Agentverse for any completed action, then start a new request if needed.';
        skipDiscovery = true;
      } else if (['payment_requested', 'card_interaction_requested'].includes(turn.pendingPlanner.status)) {
        directAssistantReply = 'That Agentverse agent requested a payment or interactive card. Yugi cannot process or approve that here, and no payment or card action was completed. Start a different request or continue with the agent in Agentverse.';
        skipDiscovery = true;
      } else if (isPlannerCancel(message.trim())) {
        directAssistantReply = 'I cancelled the paused Agentverse request. No further agent action was taken.';
        skipDiscovery = true;
      } else if (!plannerModeEnabled) {
        pendingPlannerToSave = turn.pendingPlanner;
        directAssistantReply = 'This Agentverse request was paused, but Planner Mode is currently disabled. Re-enable ASI_ONE_PLANNER_MODE and restart Yugi before continuing.';
        skipDiscovery = true;
      } else {
        plannerSessionIdForTurn = turn.pendingPlanner.sessionId;
        pendingPlannerToSave = turn.pendingPlanner;
        context += ' The user is replying to the paused Agentverse clarification. Continue the same planner session using their latest message.';
        skipDiscovery = true;
      }
    } else if (turn.pendingPlannerExpired) {
      directAssistantReply = 'That paused Agentverse request expired and was not resumed. Please start the request again.';
      skipDiscovery = true;
    } else if (turn.pendingWorkflowExpired) {
      directAssistantReply = 'That combined Calendar and email request expired. Nothing was created or sent; please start it again.';
      skipDiscovery = true;
    } else if (turn.pendingWorkflow?.type === 'calendar_meet_email') {
      pendingWorkflowToSave = turn.pendingWorkflow;
      if (isPlannerCancel(message.trim()) || isNegative(message.trim())) {
        directAssistantReply = 'Cancelled the combined Calendar and email request. Nothing was created or sent.';
        pendingWorkflowToSave = null;
        skipDiscovery = true;
      } else {
        context += ' The user is providing missing details for the pending combined Calendar event with Google Meet and Gmail workflow. Do not create or send anything until one combined confirmation is prepared and accepted.';
      }
    } else if (turn.pendingAction) {
      pendingActionToSave = null;
      if (turn.pendingAction.name === 'create_google_meet' && turn.pendingAction.flowVersion !== 2 && isAffirmative(message.trim())) {
        await clearPendingAction(turn.conversation);
        directAssistantReply = 'I could not tell whether the earlier Meet request already created a link, so I did not create another one. Check your recent Meet activity first. If you still need a new link, ask me to create one again.';
        context += ' An older Meet confirmation could not be safely retried because its previous outcome may be unknown.';
        skipDiscovery = true;
      } else if (isAffirmative(message.trim())) {
        await clearPendingAction(turn.conversation);
        const callId = `call_confirm_${randomUUID().replaceAll('-', '')}`;
        const publicArgs = Object.fromEntries(Object.entries(turn.pendingAction.args).filter(([key]) => !key.startsWith('_')));
        let result;
        try { result = await executeConfirmedAction(req.user._id, turn.pendingAction); }
        catch (error) { result = { error: error.message || 'The confirmed Google action failed.', deliveryStatus: error.deliveryStatus || 'failed' }; }
        if (turn.pendingAction.name === 'send_gmail') {
          if (result?.sent && result.messageId) {
            directAssistantReply = `Email sent to ${[...(result.to || []), ...(result.cc || []), ...(result.bcc || [])].join(', ')} with subject "${result.subject}". Gmail message ID: ${result.messageId}.`;
          } else if (result?.deliveryStatus === 'unknown') {
            directAssistantReply = `I can't confirm whether Gmail sent the email. ${result?.error || 'Check the Sent folder before retrying.'}`;
          } else {
            directAssistantReply = `The email was not sent. ${result?.error || 'Gmail did not confirm the send.'}`;
          }
        } else if (turn.pendingAction.name === 'create_calendar_event_and_send_gmail') {
          if (result?.conflict) {
            directAssistantReply = 'The time now conflicts with your calendar, so neither the event nor the email was created.';
          } else if (result?.calendarCreated === 'unknown') {
            directAssistantReply = 'I could not confirm whether Google Calendar created the event, so I did not send the email. Check your Calendar before retrying.';
          } else if (result?.calendarCreated && result.emailSent && result.email?.messageId) {
            directAssistantReply = `Added "${result.event.summary}" to Google Calendar with Meet link ${result.event.meetingLink}, then sent the email to ${[...(result.email.to || []), ...(result.email.cc || []), ...(result.email.bcc || [])].join(', ')}. Gmail message ID: ${result.email.messageId}.`;
          } else if (result?.calendarCreated && result.deliveryStatus === 'unknown') {
            directAssistantReply = `Added "${result.event.summary}" to Google Calendar with Meet link ${result.event.meetingLink}, but Gmail could not confirm the email. Check Sent before retrying. ${result.emailError || result.error || ''}`;
          } else if (result?.calendarCreated) {
            directAssistantReply = `Added "${result.event.summary}" to Google Calendar${result.event.meetingLink ? ` with Meet link ${result.event.meetingLink}` : ''}, but the email was not sent. ${result.emailError || result.error || 'Please check Gmail before trying again.'}`;
          } else {
            directAssistantReply = `The Calendar event was not created, and no email was sent. ${result?.error || 'Google did not confirm the event.'}`;
          }
        } else if (turn.pendingAction.name === 'create_google_meet') {
          directAssistantReply = result?.meetingUri
            ? `Created your Google Meet link: ${result.meetingUri}`
            : `I couldn't create the Google Meet link. ${result?.error || 'Google did not return a meeting link.'}`;
        } else if (turn.pendingAction.name === 'create_calendar_event') {
          if (result?.conflict) {
            directAssistantReply = 'That time conflicts with your calendar, so I did not add the event.';
          } else if (result?.id) {
            const attendees = result.attendees?.length ? ` Invitees: ${result.attendees.join(', ')}.` : '';
            const meet = result.meetingLink ? ` Meet link: ${result.meetingLink}` : '';
            const eventUrl = result.eventLink ? ` Calendar event: ${result.eventLink}` : '';
            directAssistantReply = `Added "${result.summary}" to your Google Calendar for ${result.start} to ${result.end} (${turn.pendingAction.args.timeZone}).${attendees}${meet}${eventUrl}`;
          } else {
            directAssistantReply = `I couldn't add the event to your Google Calendar. ${result?.error || 'Google did not confirm the event.'}`;
          }
        }
        modelMessages = [...modelMessages,
          { role: 'assistant', content: null, tool_calls: [{ id: callId, type: 'function', function: { name: turn.pendingAction.name, arguments: JSON.stringify(publicArgs) } }] },
          { role: 'tool', tool_call_id: callId, name: turn.pendingAction.name, content: JSON.stringify(result) }
        ];
        const actionLabel = turn.pendingAction.name === 'send_gmail' ? 'email' : turn.pendingAction.name === 'create_google_meet' ? 'Google Meet space' : turn.pendingAction.name === 'create_calendar_event_and_send_gmail' ? 'Calendar and email' : 'calendar';
        context += ` The user explicitly confirmed the pending ${actionLabel} action. Use the returned Google API result to say exactly what succeeded.`;
        skipDiscovery = true;
      } else if (isNegative(message.trim())) {
        await clearPendingAction(turn.conversation);
        context += ' The user declined the pending Google action. It was not executed.';
        skipDiscovery = true;
      } else {
        await clearPendingAction(turn.conversation);
        context += ' The prior unconfirmed Google action was cancelled because the user changed or continued the request without confirming. It was not executed.';
      }
    } else if (turn.pendingActionExpired) {
      context += ' A prior Google action proposal expired and was not executed.';
    }

    const recentUserEvidence = turn.modelMessages
      .filter((item) => item.role === 'user')
      .map((item) => item.content)
      .join('\n');
    const compoundCalendarMeetEmail = !skipDiscovery
      && (turn.pendingWorkflow?.type === 'calendar_meet_email'
        || (/(?:\bcalendar\b|\bevent\b|\bappointment\b|\bschedule\b|\bbook\b)/i.test(message.trim())
          && /\b(?:google\s+meet|meet(?:ing)?(?:\s+link)?)\b/i.test(message.trim())
          && /\b(?:send|email|mail)\b/i.test(message.trim())));
    if (compoundCalendarMeetEmail) {
      const previousWorkflow = turn.pendingWorkflow?.type === 'calendar_meet_email' ? turn.pendingWorkflow : {};
      const recipientsFromCurrentMessage = [...new Set((message.trim().match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((email) => email.toLowerCase()))];
      const recipients = recipientsFromCurrentMessage.length ? recipientsFromCurrentMessage : (previousWorkflow.recipients || []);
      const addAsAttendee = Boolean(previousWorkflow.addAsAttendee || /\b(?:invite|attendee|guest)\b/i.test(message.trim()));
      pendingWorkflowToSave = {
        ...previousWorkflow,
        type: 'calendar_meet_email',
        recipients,
        addAsAttendee,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
      };
      const missingConnections = [
        ...(!connectedServices.has('calendar') ? ['Google Calendar'] : []),
        ...(!connectedServices.has('gmail') ? ['Gmail'] : [])
      ];
      if (missingConnections.length) {
        directAssistantReply = `Connect ${missingConnections.join(' and ')} on the Connections page before I can prepare this combined action.`;
        skipDiscovery = true;
      } else if (!recipients.length) {
        directAssistantReply = 'What email address should receive the meeting details? I will wait for the address before preparing the Calendar event and email.';
        skipDiscovery = true;
      } else {
        try {
          const eventTools = getRelevantToolSchemas(['create_calendar_event'], connectedServices);
          const plan = await createToolPlan(modelMessages, eventTools, `${context} Prepare only the Calendar event details. The user also asked for a Google Meet link and an email; set includeMeet=true. Do not send email or create the event now.`, 'create_calendar_event');
          const call = plan?.tool_calls?.find((item) => item.function?.name === 'create_calendar_event');
          if (!call) throw new Error('Please provide the event title, date, start time, end time, and timezone so I can prepare the combined action.');
          let eventArgs;
          try { eventArgs = JSON.parse(call.function.arguments || '{}'); }
          catch { throw new Error('Please provide the event title, date, start and end times, and timezone so I can prepare the combined action.'); }
          if (!eventArgs || typeof eventArgs !== 'object' || Array.isArray(eventArgs)) throw new Error('I could not read the proposed Calendar event details.');
          eventArgs.includeMeet = true;
          if (!addAsAttendee) eventArgs.attendeeEmails = [];
          const preparedEvent = await executeToolCall(req.user._id, {
            function: { name: 'create_calendar_event', arguments: JSON.stringify(eventArgs) }
          }, new Set(['create_calendar_event']), { evidence: recentUserEvidence });
          if (preparedEvent?.needsDetails?.length) {
            directAssistantReply = `I still need ${preparedEvent.needsDetails.join(', ')} before I can prepare the event and email. Nothing has been created or sent.`;
          } else if (preparedEvent?.conflict) {
            directAssistantReply = 'That time conflicts with your calendar. Nothing has been created or sent; choose another time and I will prepare the combined action again.';
          } else if (preparedEvent?.confirmationRequired && preparedEvent.action) {
            const event = preparedEvent.event;
            const subject = `Meet details: ${event.summary}`;
            const body = `Hi,\n\nHere are the details for ${event.summary}:\n${event.start} to ${event.end} (${event.timeZone})\n\nGoogle Meet link: {{MEET_LINK}}\n\nBest,\nYugi`;
            const preparedEmail = await executeToolCall(req.user._id, {
              function: { name: 'send_gmail', arguments: JSON.stringify({ to: recipients, subject, body }) }
            }, new Set(['send_gmail']), { evidence: recentUserEvidence });
            if (!preparedEmail?.confirmationRequired || !preparedEmail.action) throw new Error('I could not prepare the Gmail message. Nothing has been created or sent.');
            pendingActionToSave = {
              name: 'create_calendar_event_and_send_gmail',
              args: { event: preparedEvent.action.args, email: preparedEmail.action.args },
              callId: `call_confirm_${randomUUID().replaceAll('-', '')}`,
              flowVersion: 2,
              expiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
            };
            const attendeeNote = event.attendeeEmails.length
              ? '\nCalendar invitations will also be sent to the listed attendees.'
              : '';
            directAssistantReply = `One confirmation will add this event to Google Calendar with a new Meet link, then send the email after Google returns the link.\n\nEvent: ${event.summary}\nStart: ${event.start}\nEnd: ${event.end}\nTimezone: ${event.timeZone}\nMeet link: generated when the event is created${attendeeNote}\n\nEmail to: ${preparedEmail.email.to.join(', ')}\nSubject: ${preparedEmail.email.subject}\n\n${preparedEmail.email.body}\n\nThe {{MEET_LINK}} marker will be replaced with the real Google Meet link. Reply “confirm” once to create the event and send the email, or “cancel”.`;
            pendingWorkflowToSave = null;
          } else {
            throw new Error('I could not prepare the Calendar event. Nothing has been created or sent.');
          }
        } catch (error) {
          directAssistantReply = error.message || 'I could not prepare the combined Calendar and email request. Nothing has been created or sent.';
        }
        skipDiscovery = true;
      }
    }

    const compoundMeetEmail = !skipDiscovery
      && /\b(?:create|make|generate)\b[\s\S]{0,80}\b(?:google\s+meet|meet(?:ing)?(?:\s+link)?)\b/i.test(message.trim())
      && /\b(?:send|email|mail)\b/i.test(message.trim())
      && /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(message.trim());
    if (compoundMeetEmail) {
      const missingConnections = [
        ...(!connectedServices.has('meet') ? ['Google Meet'] : []),
        ...(!connectedServices.has('gmail') ? ['Gmail'] : [])
      ];
      if (missingConnections.length) {
        directAssistantReply = `Connect ${missingConnections.join(' and ')} on the Connections page before I can create the Meet and prepare the email.`;
        skipDiscovery = true;
      } else {
        const evidence = turn.modelMessages
          .filter((item) => item.role === 'user')
          .map((item) => item.content)
          .join('\n');
        const recipients = [...new Set((message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((email) => email.toLowerCase()))];
        let createdMeetUri = null;
        try {
          const meetResult = await executeToolCall(req.user._id, {
            function: { name: 'create_google_meet', arguments: '{}' }
          }, new Set(['create_google_meet']), { evidence });
          if (!meetResult?.meetingUri) throw new Error('Google did not return a Meet link.');
          createdMeetUri = meetResult.meetingUri;

          const subject = 'Your Google Meet Link';
          const body = `Hi,\n\nHere is the Google Meet link: ${meetResult.meetingUri}\n\nBest,\nYugi`;
          const emailResult = await executeToolCall(req.user._id, {
            function: {
              name: 'send_gmail',
              arguments: JSON.stringify({ to: recipients, subject, body })
            }
          }, new Set(['send_gmail']), { evidence });
          if (!emailResult?.confirmationRequired || !emailResult.action) {
            throw new Error('The email could not be prepared for confirmation.');
          }
          pendingActionToSave = {
            ...emailResult.action,
            callId: `call_confirm_${randomUUID().replaceAll('-', '')}`,
            flowVersion: 2,
            expiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
          };
          const email = emailResult.email;
          directAssistantReply = `Created your Google Meet link: ${meetResult.meetingUri}\n\nI prepared this email with the actual link. The Meet is already created; confirm only if you want me to send this email.\n\nTo: ${email.to.join(', ')}\nSubject: ${email.subject}\n\n${email.body}\n\nReply “confirm” to send the email, or “cancel”.`;
        } catch (error) {
          directAssistantReply = createdMeetUri
            ? `Created your Google Meet link: ${createdMeetUri}\n\nI couldn't prepare the email, and no email was sent. ${error.message || 'Please try again.'}`
            : `I couldn't create the Google Meet link, so no email was prepared or sent. ${error.message || 'Check that Meet is connected, then try again.'}`;
        }
        skipDiscovery = true;
      }
    }

    if (!skipDiscovery) {
      const catalog = getConnectedToolCatalog(connectedServices);
      if (catalog.length) {
        const recentContext = turn.modelMessages.slice(-8).map((item) => ({ role: item.role, content: item.content }));
        const emailRequest = /\b(?:send|email|mail)\b/i.test(message.trim());
        const recipientPresent = turn.modelMessages
          .filter((item) => item.role === 'user')
          .some((item) => /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(item.content || ''));
        const directEmailSend = emailRequest && recipientPresent && connectedServices.has('gmail')
          && catalog.some((tool) => tool.name === 'send_gmail');
        const standaloneMeetRequest = /\b(?:create|make|generate)\b[\s\S]{0,50}\b(?:google\s+meet|meet(?:ing)?\s+link)\b/i.test(message.trim())
          && !/\b(?:schedule|calendar|invite|attendees?)\b/i.test(message.trim())
          && connectedServices.has('meet') && catalog.some((tool) => tool.name === 'create_google_meet');
        const calendarRequest = /\b(?:add|put|schedule|create|book)\b[\s\S]{0,100}\b(?:calendar|event|appointment|meeting)\b/i.test(message.trim())
          && !standaloneMeetRequest && connectedServices.has('calendar')
          && catalog.some((tool) => tool.name === 'create_calendar_event');
        const requiredToolName = directEmailSend ? 'send_gmail' : standaloneMeetRequest ? 'create_google_meet' : calendarRequest ? 'create_calendar_event' : null;
        const selectedNames = requiredToolName
          ? [requiredToolName]
          : await discoverWorkspaceTools({ latestRequest: message.trim(), recentContext }, catalog, context);
        const tools = getRelevantToolSchemas(selectedNames, connectedServices);
        const allowed = new Set(tools.map((tool) => tool.function.name));
        let evidence = turn.modelMessages.filter((item) => item.role === 'user').map((item) => item.content).join('\n');
        let toolCallCount = 0;
        let confirmationActionPrepared = false;
        for (let round = 0; round < 3 && tools.length && toolCallCount < 5; round += 1) {
          const plan = await createToolPlan(modelMessages, tools, context, round === 0 ? requiredToolName : null);
          if (!plan?.tool_calls?.length) break;
          const calls = plan.tool_calls.slice(0, 5 - toolCallCount);
          // Send only fields supported by the chat-completions message schema.
          // The planner response may contain provider-specific metadata that
          // cannot be replayed as a conversation message.
          modelMessages = [...modelMessages, {
            role: 'assistant',
            content: typeof plan.content === 'string' ? plan.content : null,
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: 'function',
              function: {
                name: call.function.name,
                arguments: typeof call.function.arguments === 'string'
                  ? call.function.arguments
                  : JSON.stringify(call.function.arguments ?? {})
              }
            }))
          }];
          for (const call of calls) {
            toolCallCount += 1;
            let result;
            try {
              result = await executeToolCall(req.user._id, call, allowed, { evidence });
              if (result?.confirmationRequired) {
                if (!confirmationActionPrepared) {
                  pendingActionToSave = { ...result.action, callId: call.id, flowVersion: 2, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
                  confirmationActionPrepared = true;
                  const { action: _action, ...confirmationSummary } = result;
                  result = confirmationSummary;
                } else {
                  result = { error: 'Only one Google action can be prepared at a time.' };
                }
              }
            } catch (error) { result = { error: error.message || 'Google tool call failed.' }; }
            const serialized = JSON.stringify(result);
            evidence += `\n${serialized}`;
            modelMessages = [...modelMessages, { role: 'tool', tool_call_id: call.id, content: serialized }];
          }
          if (confirmationActionPrepared) break;
        }
      }
    }
    if (directAssistantReply) {
      stream = (async function* () {
        yield { choices: [{ delta: { content: directAssistantReply } }] };
      })();
    } else {
      const response = await createTextStream(modelMessages, context, {
        plannerMode: !pendingActionToSave,
        plannerSessionId: plannerSessionIdForTurn
      });
      stream = response.stream;
      plannerSessionIdForTurn = response.plannerSessionId;
      plannerModeForStream = response.plannerMode;
      if (plannerModeForStream) {
        pendingPlannerToSave = {
          sessionId: plannerSessionIdForTurn,
          status: 'in_progress',
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
        };
        await savePendingPlannerSession(conversation, pendingPlannerToSave);
      }
    }
  } catch (error) {
    console.error('Chat request failed:', error?.status || error?.name || 'request error');
    const status = error?.statusCode || error?.status || 502;
    return res.status(status).json({
      error: status === 503 ? error.message : chatErrorMessage(error)
    });
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Conversation-Id', String(conversation._id));
  res.flushHeaders();

  let assistantText = '';
  try {
    for await (const chunk of stream) {
      if (res.destroyed) break;
      if (typeof chunk.metadata?.plan_status === 'string') {
        plannerStatus = chunk.metadata.plan_status;
        const progress = plannerProgressMessage(plannerStatus);
        if (progress && progress !== lastPlannerProgress) {
          lastPlannerProgress = progress;
          res.write(`data: ${JSON.stringify({ progress })}\n\n`);
        }
      }
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) {
        const plainContent = content.replaceAll('*', '');
        if (!plainContent) continue;
        assistantText += plainContent;
        res.write(`data: ${JSON.stringify({ content: plainContent })}\n\n`);
      }
    }

  } catch (error) {
    console.error('Chat model stream failed:', error?.status || error?.name || 'stream error', error?.message || '');
    if (!res.destroyed) {
      res.write(`data: ${JSON.stringify({ error: assistantText
        ? 'The model response was interrupted before it finished. Please try again.'
        : chatErrorMessage(error) })}\n\n`);
      res.end();
    }
    return;
  }

  if (plannerModeForStream && ['clarification_requested', 'payment_requested', 'card_interaction_requested'].includes(plannerStatus)) {
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    pendingPlannerToSave = { sessionId: plannerSessionIdForTurn, status: plannerStatus, expiresAt };
    let notice = '';
    if (plannerStatus === 'clarification_requested' && !assistantText) {
      notice = 'The Agentverse agent needs clarification to continue. Reply with the requested detail, or say “cancel”.';
    } else if (plannerStatus !== 'clarification_requested') {
      notice = '\n\nYugi cannot process payments or interactive agent cards in this chat. No payment or card action was completed.';
    }
    if (notice) {
      assistantText += notice;
      res.write(`data: ${JSON.stringify({ content: notice })}\n\n`);
    }
  } else if (plannerModeForStream) {
    pendingPlannerToSave = null;
  }

  if (!res.destroyed) {
    try {
      await saveAssistantReply(conversation, assistantText, pendingActionToSave, pendingPlannerToSave, pendingWorkflowToSave);
    } catch (error) {
      console.error('Chat reply save failed:', error?.name || 'save error', error?.message || '');
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify({ error: 'The response was generated, but could not be saved to chat history.' })}\n\n`);
        res.end();
      }
      return;
    }
  }
  if (!res.destroyed) {
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

function chatErrorMessage(error) {
  const provider = error?.provider || 'ASI:One';
  const keyName = 'ASI_ONE_API_KEY';
  const modelName = 'ASI_ONE_MODEL';
  if (error?.status === 401) return `${provider} rejected the API key. Check ${keyName} in .env and restart the server.`;
  if (error?.status === 403) return `The ${provider} API key does not have access to this model.`;
  if (error?.status === 404) return `${provider} could not find the configured model. Check ${modelName} in .env.`;
  if (error?.status === 429) return `${provider} is rate-limiting requests right now. Wait a moment and try again.`;
  if (error?.status >= 500 || error?.name === 'APIConnectionError' || error?.name === 'APIConnectionTimeoutError') {
    return `${provider} is temporarily unavailable. Please try again in a moment.`;
  }
  return `The ${provider} request failed. Check the server log for the provider error, then try again.`;
}

function isAffirmative(message) {
  return /^(?:yes|yes please|yes do it|yes send it|send it|confirm|confirm it|go ahead|proceed|book it|create it|send the invitation|send the email)[.! ]*$/i.test(message.trim().replace(/,/g, ''));
}

function isNegative(message) {
  return /^(?:no|no thanks|cancel|don't|do not|not now|stop)[.! ]*$/i.test(message);
}

function isPlannerCancel(message) {
  return /^(?:cancel|stop|never mind|nevermind|cancel that)[.! ]*$/i.test(message);
}

function plannerProgressMessage(status) {
  const messages = {
    pending: 'Preparing a plan…',
    in_progress: 'Working through the plan…',
    searching_agents: 'Searching Agentverse…',
    waiting_response: 'Waiting for an Agentverse agent…',
    analyzing_image: 'Reviewing the request…',
    clarification_requested: 'Waiting for your clarification…',
    payment_requested: 'An agent requested a payment confirmation…',
    card_interaction_requested: 'An agent requested an interactive confirmation…',
    completed: 'Finishing the reply…',
    failed: 'Finishing with the available information…',
    error: 'Finishing with the available information…',
    timeout: 'Finishing with the available information…',
    skipped: 'Finishing with the available information…'
  };
  return messages[status] || null;
}
