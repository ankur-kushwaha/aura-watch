/**
 * wifiCredentials.ts
 * AES-256-GCM encrypt/decrypt for WiFi passwords stored in MongoDB.
 * The key comes from WIFI_CREDENTIAL_SECRET in the backend .env.
 *
 * The encrypted value format: <iv_hex>:<authTag_hex>:<ciphertext_hex>
 * This is safe to store in the database and never returned to the frontend.
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const secret = process.env.WIFI_CREDENTIAL_SECRET || "DEFAULT_KEY";
  if (!secret || secret.length < 16) {
    throw new Error(
      'WIFI_CREDENTIAL_SECRET must be set in backend .env (min 16 chars). ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  // Derive a 32-byte key via SHA-256 so any string length works
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypt a plaintext WiFi password for storage.
 * Returns a string of the form <iv_hex>:<authTag_hex>:<ciphertext_hex>
 */
export function encryptWifiPassword(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv) as crypto.CipherGCM;
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a stored WiFi password. Returns null if decryption fails.
 */
export function decryptWifiPassword(stored: string): string | null {
  try {
    const parts = stored.split(':');
    if (parts.length !== 3) return null;
    const [ivHex, authTagHex, ciphertextHex] = parts;
    const key = getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv) as crypto.DecipherGCM;
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Check if WIFI_CREDENTIAL_SECRET is configured.
 */
export function isWifiEncryptionConfigured(): boolean {
  const secret = process.env.WIFI_CREDENTIAL_SECRET;
  return typeof secret === 'string' && secret.length >= 16;
}
