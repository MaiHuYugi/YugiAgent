import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

const encodedMasterKey = process.env.DATA_ENCRYPTION_KEY?.trim();
if (!encodedMasterKey) throw new Error('DATA_ENCRYPTION_KEY is required (32 random bytes encoded as base64).');

const masterKey = Buffer.from(encodedMasterKey, 'base64');
if (masterKey.length !== 32 || masterKey.toString('base64') !== encodedMasterKey) {
  throw new Error('DATA_ENCRYPTION_KEY must be a valid base64 encoding of exactly 32 random bytes.');
}

const encryptionKey = Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), 'yugi-data-encryption-v1', 32));
const lookupKey = Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), 'yugi-google-id-lookup-v1', 32));

export function encryptText(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

export function decryptText(envelope) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

export function hashGoogleId(googleId) {
  return createHmac('sha256', lookupKey).update(googleId).digest('hex');
}
