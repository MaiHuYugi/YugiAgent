import { OAuth2Client } from 'google-auth-library';
import env from './env.js';

export const googleOAuthClient = new OAuth2Client(
  env.googleClientId,
  env.googleClientSecret,
  env.googleCallbackUrl
);

export function createGoogleAuthorizationUrl(state) {
  return googleOAuthClient.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    state,
    prompt: 'select_account'
  });
}

export const googleServices = Object.freeze({
  calendar: { label: 'Google Calendar', scopes: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'] },
  meet: { label: 'Google Meet', scopes: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/meetings.space.created'] },
  gmail: { label: 'Gmail', scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.send'] },
  drive: { label: 'Google Drive', scopes: ['https://www.googleapis.com/auth/drive.readonly'] }
});

export function createGoogleServiceAuthorizationUrl(state, service) {
  const definition = googleServices[service];
  if (!definition) throw new Error('Unknown Google service.');
  const client = new OAuth2Client(env.googleClientId, env.googleClientSecret, env.googleCallbackUrl);
  return client.generateAuthUrl({ access_type: 'offline', include_granted_scopes: true, prompt: 'consent select_account', scope: ['openid', 'email', ...definition.scopes], state });
}

export async function exchangeGoogleServiceCode(code) {
  const client = new OAuth2Client(env.googleClientId, env.googleClientSecret, env.googleCallbackUrl);
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) throw new Error('Google did not return an access token.');
  const ticket = tokens.id_token ? await client.verifyIdToken({ idToken: tokens.id_token, audience: env.googleClientId }) : null;
  return { tokens, googleId: ticket?.getPayload()?.sub, email: ticket?.getPayload()?.email };
}

export async function verifyGoogleAuthorizationCode(code) {
  const { tokens } = await googleOAuthClient.getToken(code);
  if (!tokens.id_token) throw new Error('Google did not return an ID token.');

  const ticket = await googleOAuthClient.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.googleClientId
  });
  const profile = ticket.getPayload();
  if (!profile?.sub || !profile.email || !profile.email_verified) {
    throw new Error('Google profile is missing a verified identity.');
  }
  return profile;
}
