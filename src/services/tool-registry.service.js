import { randomBytes } from 'node:crypto';
import { googleServices } from '../config/google-oauth.js';
import {
  checkCalendarAvailability,
  createCalendarMeetEvent,
  createGoogleMeetSpace,
  listCalendarEvents,
  sendGmailDraft,
  searchDrive,
  searchGmail,
  validateGmailEmail
} from './google-workspace.service.js';

const definitions = {
  search_gmail: {
    services: ['gmail'],
    description: 'Search email messages and threads by sender, topic, or date, including finding a participant email address from prior correspondence. Synonyms: inbox, mail, correspondence, admission email, receipt email. Read-only; returns sender, subject, date, and snippet.',
    schema: { type: 'object', properties: { query: { type: 'string', description: 'Gmail search query, for example from:rahul subject:invoice.' } }, required: ['query'], additionalProperties: false },
    execute: searchGmail
  },
  send_gmail: {
    services: ['gmail'],
    description: 'Prepare an email for sending. Requires at least one explicit recipient email, a subject, and the complete plain-text body. Recipients must come from the user or Gmail search results, never be guessed. This tool always requires a separate explicit user confirmation after showing the exact recipients, subject, and body. Do not send before confirmation.',
    schema: { type: 'object', properties: {
      to: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20, description: 'Primary recipient email addresses.' },
      cc: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Optional CC recipient email addresses.' },
      bcc: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Optional BCC recipient email addresses.' },
      subject: { type: 'string', description: 'Exact email subject.' },
      body: { type: 'string', description: 'Complete plain-text email body.' }
    }, required: ['to', 'subject', 'body'], additionalProperties: false }
  },
  create_google_meet: {
    services: ['meet'],
    description: 'Create a standalone Google Meet space and return its join link when the user explicitly asks to create one. Execute the requested creation immediately without a second confirmation. This does not schedule a Calendar event or invite attendees.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    execute: createGoogleMeetSpace
  },
  search_drive: {
    services: ['drive'],
    description: 'Find files in Google Drive by name or contents. Synonyms: document, PDF, spreadsheet, presentation, invoice, receipt, report, folder. Read-only; returns file metadata.',
    schema: { type: 'object', properties: { query: { type: 'string', description: 'Words to find in Drive file names and content.' } }, required: ['query'], additionalProperties: false },
    execute: searchDrive
  },
  list_calendar_events: {
    services: ['calendar'],
    description: 'View upcoming appointments, meetings, events, and agenda items in the primary calendar. Read-only.',
    schema: { type: 'object', properties: { timeMin: { type: 'string', description: 'RFC3339 start time, if known.' }, timeMax: { type: 'string', description: 'RFC3339 end time, if known.' } }, additionalProperties: false },
    execute: listCalendarEvents
  },
  check_calendar_availability: {
    services: ['calendar'],
    description: 'Check free/busy availability for a proposed time range before arranging a meeting. Requires RFC3339 start and end times and the user timezone. Read-only.',
    schema: { type: 'object', properties: { timeMin: { type: 'string', description: 'RFC3339 start time.' }, timeMax: { type: 'string', description: 'RFC3339 end time.' }, timeZone: { type: 'string', description: 'IANA timezone for the requested times.' } }, required: ['timeMin', 'timeMax', 'timeZone'], additionalProperties: false },
    execute: checkCalendarAvailability
  },
  create_calendar_event: {
    services: ['calendar'],
    description: 'Add an event to the primary Google Calendar. Ask for any missing title, exact start/end date-times, or timezone; never invent dates, times, or attendee emails. Attendees are optional. Request a Google Meet link only when the user asks for one. Always show the complete event details and ask for explicit confirmation before creating it or sending invitations.',
    schema: { type: 'object', properties: {
      summary: { type: 'string', description: 'Short event title.' },
      start: { type: 'string', description: 'RFC3339 start date and time.' },
      end: { type: 'string', description: 'RFC3339 end date and time.' },
      timeZone: { type: 'string', description: 'IANA timezone.' },
      attendeeEmails: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'Optional verified attendee email addresses supplied by the user or returned from Gmail.' },
      description: { type: 'string', description: 'Optional event details.' },
      includeMeet: { type: 'boolean', description: 'Set true only if the user requests a Google Meet link.' }
    }, additionalProperties: false }
  }
};

export function getConnectedToolCatalog(connectedServices) {
  return Object.entries(definitions)
    .filter(([, definition]) => definition.services.every((service) => connectedServices.has(service)))
    .map(([name, definition]) => ({ name, description: definition.description }));
}

export function getRelevantToolSchemas(toolNames, connectedServices) {
  return [...new Set(toolNames)].filter((name) => {
    const definition = definitions[name];
    return definition && definition.services.every((service) => connectedServices.has(service));
  }).map((name) => ({ type: 'function', function: { name, description: definitions[name].description, parameters: definitions[name].schema } }));
}

export async function executeToolCall(userId, call, allowedNames, { evidence = '', confirmation = false } = {}) {
  const name = call?.function?.name;
  const definition = definitions[name];
  if (!definition || !allowedNames.has(name) || !definition.services.every((service) => googleServices[service])) throw new Error('Tool call is not available for this request.');
  let args;
  try { args = JSON.parse(call.function.arguments || '{}'); }
  catch { throw new Error('The tool supplied invalid arguments.'); }
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('The tool supplied invalid arguments.');

  if (name === 'search_gmail' || name === 'search_drive') {
    assertKeys(args, ['query']);
    if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 300) throw new Error('Search query must contain 1 to 300 characters.');
    return definition.execute(userId, args.query.trim());
  }
  if (name === 'send_gmail') {
    const email = validateGmailEmail(args);
    const verifiedEmails = new Set((evidence.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((address) => address.toLowerCase()));
    if ([...email.to, ...email.cc, ...email.bcc].some((address) => !verifiedEmails.has(address))) {
      throw new Error('I need each recipient email address from you or a Gmail search result before preparing the email.');
    }
    return {
      confirmationRequired: true,
      email: { to: email.to, cc: email.cc, bcc: email.bcc, subject: email.subject, body: email.body },
      action: { name, args: email }
    };
  }
  if (name === 'create_google_meet') {
    assertKeys(args, []);
    return definition.execute(userId);
  }
  if (name === 'list_calendar_events') {
    assertKeys(args, ['timeMin', 'timeMax']);
    validateTimeBounds(args);
    return definition.execute(userId, args);
  }
  if (name === 'check_calendar_availability') {
    assertKeys(args, ['timeMin', 'timeMax', 'timeZone']);
    validateTimeBounds(args, true);
    validateTimeZone(args.timeZone);
    return { busy: await definition.execute(userId, args) };
  }
  if (name === 'create_calendar_event') {
    const missing = [];
    if (typeof args.summary !== 'string' || !args.summary.trim()) missing.push('event title');
    if (typeof args.start !== 'string' || typeof args.end !== 'string') missing.push('start and end date-times');
    if (typeof args.timeZone !== 'string') missing.push('timezone');
    if (missing.length) return { needsDetails: missing };
    if (!hasExplicitEventTime(evidence)) return { needsDetails: ['start and end times'] };
    const clean = validateEvent(args, false);
    const emails = clean.attendeeEmails.map((email) => email.toLowerCase());
    const verifiedEmails = new Set((evidence.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((email) => email.toLowerCase()));
    if (emails.some((email) => !verifiedEmails.has(email))) throw new Error('I need the attendee email address from you or a Gmail search result before preparing the invitation.');
    const busy = await checkCalendarAvailability(userId, { timeMin: clean.start, timeMax: clean.end, timeZone: clean.timeZone });
    if (busy.length) return { conflict: true, busy };
    return {
      confirmationRequired: true,
      event: clean,
      action: { name, args: { ...clean, _eventId: randomBytes(16).toString('hex'), _conferenceRequestId: randomBytes(16).toString('hex') } }
    };
  }
  throw new Error('Tool call is not available for this request.');
}

export async function executeConfirmedAction(userId, action) {
  if (!action?.args) throw new Error('The pending action is invalid.');
  if (action.name === 'send_gmail') return sendGmailDraft(userId, validateGmailEmail(action.args));
  if (action.name === 'create_calendar_event_and_send_gmail') {
    return createCalendarEventAndSendGmail(userId, action.args);
  }
  if (action.name === 'create_google_meet') {
    assertKeys(action.args, []);
    return createGoogleMeetSpace(userId);
  }
  if (action.name !== 'create_calendar_event') throw new Error('The pending action is invalid.');
  const args = validateEvent(action.args, true);
  args._eventId = action.args._eventId;
  args._conferenceRequestId = action.args._conferenceRequestId;
  const busy = await checkCalendarAvailability(userId, { timeMin: args.start, timeMax: args.end, timeZone: args.timeZone });
  if (busy.length) return { conflict: true, busy };
  return createCalendarMeetEvent(userId, args);
}

async function createCalendarEventAndSendGmail(userId, args) {
  assertKeys(args, ['event', 'email']);
  if (!args.event || typeof args.event !== 'object' || !args.email || typeof args.email !== 'object') {
    throw new Error('The combined Calendar and email action is invalid.');
  }
  const eventArgs = validateEvent(args.event, true);
  eventArgs.includeMeet = true;
  eventArgs._eventId = args.event._eventId;
  eventArgs._conferenceRequestId = args.event._conferenceRequestId;
  const emailArgs = validateGmailEmail(args.email);
  const meetMarker = '{{MEET_LINK}}';
  if (emailArgs.body.split(meetMarker).length !== 2) {
    throw new Error('The confirmed email must contain exactly one generated Meet link placeholder.');
  }

  const busy = await checkCalendarAvailability(userId, {
    timeMin: eventArgs.start,
    timeMax: eventArgs.end,
    timeZone: eventArgs.timeZone
  });
  if (busy.length) return { conflict: true, busy };

  let event;
  try {
    event = await createCalendarMeetEvent(userId, eventArgs);
  } catch (error) {
    return {
      calendarCreated: !error.statusCode || error.statusCode >= 500 ? 'unknown' : false,
      deliveryStatus: !error.statusCode || error.statusCode >= 500 ? 'unknown' : 'not_sent',
      error: error.message || 'Google Calendar did not confirm the event.'
    };
  }
  if (!event?.id) {
    return { calendarCreated: 'unknown', deliveryStatus: 'unknown', error: 'Google Calendar did not return an event ID.' };
  }
  if (!event.meetingLink) {
    return {
      calendarCreated: true,
      event,
      emailSent: false,
      deliveryStatus: 'not_sent',
      error: 'The event was added, but Google did not return its Meet link. No email was sent.'
    };
  }

  let emailResult;
  try {
    emailResult = await sendGmailDraft(userId, {
      ...emailArgs,
      body: emailArgs.body.replace(meetMarker, event.meetingLink)
    });
  } catch (error) {
    return {
      calendarCreated: true,
      event,
      emailSent: false,
      deliveryStatus: error.deliveryStatus || 'not_sent',
      emailError: error.message || 'Gmail did not confirm the email.'
    };
  }
  if (!emailResult?.sent || !emailResult.messageId) {
    return {
      calendarCreated: true,
      event,
      emailSent: false,
      deliveryStatus: emailResult?.deliveryStatus || 'unknown',
      emailError: emailResult?.error || 'Gmail did not return a sent message ID.'
    };
  }
  return { calendarCreated: true, event, emailSent: true, email: emailResult };
}

function validateTimeBounds(args, required = false) {
  for (const key of ['timeMin', 'timeMax']) {
    if (required && typeof args[key] !== 'string') throw new Error('A start and end time are required.');
    if (args[key] !== undefined && (typeof args[key] !== 'string' || Number.isNaN(Date.parse(args[key])))) throw new Error('Calendar time bounds must be valid dates.');
  }
  if (args.timeMin && args.timeMax && Date.parse(args.timeMax) <= Date.parse(args.timeMin)) throw new Error('The end time must be after the start time.');
}

function assertKeys(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('The tool supplied an unsupported argument.');
}

function validateTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length > 64) throw new Error('A valid timezone is required.');
  try { new Intl.DateTimeFormat('en', { timeZone }); } catch { throw new Error('A valid timezone is required.'); }
}

function hasExplicitEventTime(text) {
  return /\b(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*(?:a\.?m\.?|p\.?m\.?))?\b|\b(?:1[0-2]|0?[1-9])\s*(?:a\.?m\.?|p\.?m\.?)\b/i.test(text);
}

function validateEvent(args, defaultIncludeMeet = false) {
  const allowed = ['summary', 'start', 'end', 'timeZone', 'attendeeEmails', 'description', 'includeMeet', '_eventId', '_conferenceRequestId'];
  if (Object.keys(args).some((key) => !allowed.includes(key))) throw new Error('The event contains an unsupported field.');
  if (typeof args.summary !== 'string' || !args.summary.trim() || args.summary.length > 180) throw new Error('An event title of 1 to 180 characters is required.');
  if (typeof args.start !== 'string' || Number.isNaN(Date.parse(args.start)) || typeof args.end !== 'string' || Number.isNaN(Date.parse(args.end))) throw new Error('Valid start and end date-times are required.');
  if (Date.parse(args.end) <= Date.parse(args.start)) throw new Error('The end time must be after the start time.');
  if (Date.parse(args.start) <= Date.now()) throw new Error('The event start time must be in the future.');
  validateTimeZone(args.timeZone);
  const attendeeEmails = args.attendeeEmails ?? [];
  if (!Array.isArray(attendeeEmails) || attendeeEmails.length > 10 || attendeeEmails.some((email) => typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Attendee email addresses must be valid, with no more than ten attendees.');
  if (args.description !== undefined && (typeof args.description !== 'string' || args.description.length > 2000)) throw new Error('Event details must be 2,000 characters or fewer.');
  if (args.includeMeet !== undefined && typeof args.includeMeet !== 'boolean') throw new Error('includeMeet must be true or false.');
  return {
    ...args,
    summary: args.summary.trim(),
    attendeeEmails: [...new Set(attendeeEmails.map((email) => email.trim().toLowerCase()))],
    includeMeet: args.includeMeet === undefined ? defaultIncludeMeet : args.includeMeet
  };
}
