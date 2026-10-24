import { OAuth2Client } from 'google-auth-library';
import { User } from '../models/user.model.js';
import { decryptText, encryptText } from './encryption.service.js';
import env from '../config/env.js';
import { randomBytes } from 'node:crypto';

const API_TIMEOUT_MS = 10_000;

export async function googleRequest(userId, service, url, options = {}) {
  const user = await User.findById(userId).select('+googleConnections');
  const encrypted = user?.googleConnections?.get(service);
  if (!encrypted) throw new Error(`Connect ${service} in Workspace connections first.`);
  const credentials = JSON.parse(decryptText(encrypted));
  let accessToken = credentials.access_token;
  if (!accessToken || (credentials.expiry_date && credentials.expiry_date < Date.now() + 60_000)) {
    if (!credentials.refresh_token) throw new Error(`Reconnect ${service} to refresh its Google authorization.`);
    const client = new OAuth2Client(env.googleClientId, env.googleClientSecret);
    client.setCredentials({ refresh_token: credentials.refresh_token });
    const { credentials: refreshed } = await client.refreshAccessToken();
    credentials.access_token = refreshed.access_token;
    credentials.expiry_date = refreshed.expiry_date;
    user.googleConnections.set(service, encryptText(JSON.stringify(credentials)));
    await user.save();
    accessToken = credentials.access_token;
  }
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(API_TIMEOUT_MS)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Google ${service} request failed (${response.status}).`);
    error.statusCode = response.status;
    throw error;
  }
  return payload;
}

export async function searchGmail(userId, query) {
  const params = new URLSearchParams({ q: query, maxResults: '3' });
  const result = await googleRequest(userId, 'gmail', `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`);
  const messages = await Promise.all((result.messages || []).slice(0, 3).map(async ({ id }) => {
    const item = await googleRequest(userId, 'gmail', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    const headers = Object.fromEntries((item.payload?.headers || []).map((header) => [header.name.toLowerCase(), header.value]));
    return { id: item.id, from: headers.from, subject: headers.subject, date: headers.date, snippet: item.snippet };
  }));
  return messages;
}

export function validateGmailEmail(args) {
  assertKeys(args, ['to', 'cc', 'bcc', 'subject', 'body']);
  const cleanAddresses = (value, field) => {
    if (value === undefined && field !== 'to') return [];
    if (!Array.isArray(value) || value.length > 20 || value.some((email) => typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
      throw new Error(`${field.toUpperCase()} must contain valid email addresses.`);
    }
    return [...new Set(value.map((email) => email.trim().toLowerCase()))];
  };
  const to = cleanAddresses(args.to, 'to');
  const cc = cleanAddresses(args.cc, 'cc');
  const bcc = cleanAddresses(args.bcc, 'bcc');
  if (!to.length) throw new Error('At least one To email address is required.');
  if (to.length + cc.length + bcc.length > 20) throw new Error('An email can have at most 20 recipients.');
  if (new Set([...to, ...cc, ...bcc]).size !== to.length + cc.length + bcc.length) throw new Error('Each recipient can appear only once.');
  if (typeof args.subject !== 'string' || !args.subject.trim() || args.subject.length > 250 || /[\r\n]/.test(args.subject)) throw new Error('A subject of 1 to 250 characters is required.');
  if (typeof args.body !== 'string' || !args.body.trim() || args.body.length > 20000) throw new Error('An email body of 1 to 20,000 characters is required.');
  return { to, cc, bcc, subject: args.subject.trim(), body: args.body };
}

export async function sendGmailDraft(userId, args) {
  const email = validateGmailEmail(args);
  const headers = [];
  headers.push(`To: ${email.to.join(', ')}`);
  if (email.cc.length) headers.push(`Cc: ${email.cc.join(', ')}`);
  if (email.bcc.length) headers.push(`Bcc: ${email.bcc.join(', ')}`);
  headers.push(`Subject: ${encodeMimeHeader(email.subject)}`);
  headers.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64');
  const body = Buffer.from(email.body, 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
  const raw = Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}`, 'utf8').toString('base64url');
  const base = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts';
  let draft;
  try {
    draft = await googleRequest(userId, 'gmail', base, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw } })
    });
  } catch (error) {
    error.deliveryStatus = 'not_sent';
    throw error;
  }
  if (!draft.id) throw new Error('Gmail created the draft but did not return a draft ID.');
  let sent;
  try {
    sent = await googleRequest(userId, 'gmail', `${base}/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: draft.id })
    });
  } catch (error) {
    const outcomeUnknown = !error.statusCode || error.statusCode >= 500;
    error.deliveryStatus = outcomeUnknown ? 'unknown' : 'not_sent';
    error.message = outcomeUnknown
      ? 'Gmail did not confirm whether the email was sent. Check the Sent folder before retrying.'
      : `Gmail rejected the send request. The email was not sent. ${error.message}`;
    throw error;
  }
  if (!sent.id) {
    return {
      sent: false,
      deliveryStatus: 'unknown',
      error: 'Gmail did not return a sent message ID. Check the Sent folder before retrying.'
    };
  }
  return { sent: true, messageId: sent.id, threadId: sent.threadId, to: email.to, cc: email.cc, bcc: email.bcc, subject: email.subject };
}

function assertKeys(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('The email contains an unsupported field.');
}

function encodeMimeHeader(value) {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export async function searchDrive(userId, query) {
  const escapedQuery = query.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
  const params = new URLSearchParams({ q: `trashed = false and fullText contains '${escapedQuery}'`, pageSize: '8', fields: 'files(id,name,mimeType,modifiedTime,webViewLink)' });
  return (await googleRequest(userId, 'drive', `https://www.googleapis.com/drive/v3/files?${params}`)).files || [];
}

export async function listCalendarEvents(userId, { timeMin, timeMax } = {}) {
  const params = new URLSearchParams({ maxResults: '10', orderBy: 'startTime', singleEvents: 'true', timeMin: timeMin || new Date().toISOString() });
  if (timeMax) params.set('timeMax', timeMax);
  const result = await googleRequest(userId, 'calendar', `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`);
  return (result.items || []).map((event) => ({ id: event.id, summary: event.summary, start: event.start?.dateTime || event.start?.date, end: event.end?.dateTime || event.end?.date, link: event.htmlLink, meetingLink: event.hangoutLink || null }));
}

export async function checkCalendarAvailability(userId, { timeMin, timeMax, timeZone = 'UTC' }) {
  const result = await googleRequest(userId, 'calendar', 'https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin, timeMax, timeZone, items: [{ id: 'primary' }] })
  });
  return result.calendars?.primary?.busy || [];
}

export async function createGoogleMeetSpace(userId) {
  const space = await googleRequest(userId, 'meet', 'https://meet.googleapis.com/v2/spaces', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  });
  if (!space.meetingUri) throw new Error('Google created a meeting space but did not return its meeting link.');
  return { meetingUri: space.meetingUri, meetingCode: space.meetingCode || null, spaceName: space.name || null };
}

export async function createCalendarMeetEvent(userId, args) {
  const eventId = args._eventId || randomBytes(16).toString('hex');
  const conferenceRequestId = args._conferenceRequestId || randomBytes(16).toString('hex');
  const includeMeet = args.includeMeet === true;
  const attendees = (args.attendeeEmails || []).map((email) => ({ email }));
  const event = {
    id: eventId,
    summary: args.summary,
    description: args.description || undefined,
    start: { dateTime: args.start, timeZone: args.timeZone },
    end: { dateTime: args.end, timeZone: args.timeZone },
    ...(attendees.length ? { attendees } : {}),
    ...(includeMeet ? { conferenceData: { createRequest: { requestId: conferenceRequestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {})
  };
  const insertUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  if (includeMeet) insertUrl.searchParams.set('conferenceDataVersion', '1');
  if (attendees.length) insertUrl.searchParams.set('sendUpdates', 'all');
  let created;
  try {
    created = await googleRequest(userId, 'calendar', insertUrl.href, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event)
    });
  } catch (error) {
    if (error.statusCode !== 409) throw error;
    created = await googleRequest(userId, 'calendar', `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`);
  }

  let verified = created;
  if (includeMeet) {
    verified = await googleRequest(userId, 'calendar', `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(created.id || eventId)}`);
    for (let attempt = 0; attempt < 3 && verified.conferenceData?.createRequest?.status?.statusCode === 'pending'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      verified = await googleRequest(userId, 'calendar', `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(created.id || eventId)}`);
    }
  }
  const meetingLink = verified.hangoutLink || verified.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri || null;
  return {
    id: verified.id,
    summary: verified.summary,
    start: verified.start?.dateTime,
    end: verified.end?.dateTime,
    attendees: (verified.attendees || []).map((attendee) => attendee.email),
    eventLink: verified.htmlLink,
    meetingLink,
    meetingLinkStatus: includeMeet ? (verified.conferenceData?.createRequest?.status?.statusCode || (meetingLink ? 'success' : 'unavailable')) : 'not_requested'
  };
}
