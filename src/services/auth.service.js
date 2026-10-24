import { User } from '../models/user.model.js';
import { encryptText, hashGoogleId } from './encryption.service.js';
import { verifyGoogleAuthorizationCode } from '../config/google-oauth.js';

export async function signInWithGoogle(code) {
  const googleProfile = await verifyGoogleAuthorizationCode(code);
  const googleIdHash = hashGoogleId(googleProfile.sub);
  const profile = encryptText(JSON.stringify({
    googleId: googleProfile.sub,
    email: googleProfile.email,
    name: googleProfile.name || googleProfile.email.split('@')[0] || 'Yugi user',
    picture: googleProfile.picture || null
  }));

  let user = await User.findOne({ googleIdHash }).select('+googleIdHash +profile');
  if (user) {
    user.profile = profile;
    user.lastLoginAt = new Date();
  } else {
    user = new User({ googleIdHash, profile });
  }
  await user.save();
  return user;
}
