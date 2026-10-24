import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createGoogleAuthorizationUrl, createGoogleServiceAuthorizationUrl, exchangeGoogleServiceCode, googleServices } from '../config/google-oauth.js';
import { signInWithGoogle } from '../services/auth.service.js';
import { User } from '../models/user.model.js';
import { encryptText, decryptText } from '../services/encryption.service.js';

export async function beginGoogleSignIn(req, res, next) {
  try {
    const state = randomBytes(32).toString('base64url');
    req.session.oauthState = state;
    await saveSession(req);
    res.redirect(302, createGoogleAuthorizationUrl(state));
  } catch (error) {
    next(error);
  }
}

export async function beginGoogleServiceConnect(req, res, next) {
  try {
    if (!req.session?.userId || !googleServices[req.params.service]) return res.status(401).redirect('/integrations.html');
    const state = randomBytes(32).toString('base64url');
    req.session.googleConnectState = {
      state,
      service: req.params.service,
      userId: req.session.userId,
      returnTo: req.query.returnTo === '/cli' ? '/cli' : '/integrations.html'
    };
    await saveSession(req);
    res.redirect(302, createGoogleServiceAuthorizationUrl(state, req.params.service));
  } catch (error) { next(error); }
}

export async function completeGoogleSignIn(req, res) {
  const connect = req.session?.googleConnectState;
  if (connect) {
    delete req.session.googleConnectState;
    const connectionReturn = connect.returnTo === '/cli' ? '/cli?view=connections&google=' : '/integrations.html?google=';
    if (!stateMatches(req.query.state, connect.state) || typeof req.query.code !== 'string' || !googleServices[connect.service]) return res.redirect(`${connectionReturn}failed`);
    try {
      const { tokens, googleId, email } = await exchangeGoogleServiceCode(req.query.code);
      const user = await User.findById(connect.userId).select('+profile +googleConnections');
      if (!user || String(req.session.userId) !== String(user._id)) return res.redirect(`${connectionReturn}failed`);
      const profile = JSON.parse(decryptText(user.profile));
      if (googleId && googleId !== profile.googleId) return res.redirect(`${connectionReturn}failed`);
      const previous = user.googleConnections?.get(connect.service);
      const previousTokens = previous ? JSON.parse(decryptText(previous)) : {};
      user.googleConnections ??= new Map();
      user.googleConnections.set(connect.service, encryptText(JSON.stringify({ ...previousTokens, ...tokens, email: email || previousTokens.email, connectedAt: new Date().toISOString() })));
      await user.save();
      return res.redirect(`${connectionReturn}connected`);
    } catch (error) {
      console.error('Google service connection failed:', error?.name || 'OAuth error');
      return res.redirect(`${connectionReturn}failed`);
    }
  }
  const expectedState = req.session?.oauthState;
  delete req.session.oauthState;
  if (req.query.error || !stateMatches(req.query.state, expectedState) || typeof req.query.code !== 'string') {
    return res.redirect('/?auth=failed');
  }

  try {
    const user = await signInWithGoogle(req.query.code);
    await regenerateSession(req);
    req.session.userId = String(user._id);
    await saveSession(req);
    res.redirect(303, '/index.html');
  } catch (error) {
    console.error('Google sign-in failed:', error?.name || 'OAuth error');
    res.redirect('/?auth=failed');
  }
}

function stateMatches(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
}
