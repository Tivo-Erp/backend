import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

/**
 * PII field encryption — AES-256-GCM (ADR-007).
 *
 * This is a placeholder for a KMS/Vault-backed envelope-encryption scheme.
 * The data-encryption key is derived from `PII_ENCRYPTION_KEY` via scrypt so a
 * passphrase of any length yields a valid 32-byte key. In production this must
 * be replaced by a managed key (Vault transit / AWS KMS) and per-tenant keys.
 *
 * The key is derived ONCE per passphrase and cached: scrypt is deliberately
 * expensive (~tens of ms) and must not run per value on the event loop.
 * Uniqueness per ciphertext comes from the random IV, not a per-value salt.
 *
 * Wire format (base64): [ version(1)=0x02 | iv(12) | authTag(16) | ciphertext ].
 */
const ALGO = 'aes-256-gcm';
const VERSION = 0x02;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
// Fixed KDF salt: key rotation happens by changing the passphrase (re-encrypt),
// not per-value salts. Bump alongside VERSION if the scheme ever changes.
const KDF_SALT = Buffer.from('erp-pii-kdf-v2', 'utf8');

const keyCache = new Map<string, Buffer>();

function masterSecret(): string {
  const secret = process.env.PII_ENCRYPTION_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      'PII_ENCRYPTION_KEY is not set or too short (min 16 chars). Refusing to handle PII.',
    );
  }
  return secret;
}

function dataKey(): Buffer {
  const secret = masterSecret();
  let key = keyCache.get(secret);
  if (!key) {
    key = scryptSync(secret, KDF_SALT, KEY_LEN);
    keyCache.set(secret, key);
  }
  return key;
}

export class PiiCrypto {
  /** Encrypts a plaintext string. Returns base64 wire format. */
  static encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, dataKey(), iv);
    const enc = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([VERSION]), iv, tag, enc]).toString(
      'base64',
    );
  }

  /** Decrypts a base64 wire-format value back to plaintext. */
  static decrypt(payload: string): string {
    const buf = Buffer.from(payload, 'base64');
    if (buf.length < 1 + IV_LEN + TAG_LEN || buf[0] !== VERSION) {
      throw new Error(
        'PII_PAYLOAD_INVALID: unknown version or truncated payload',
      );
    }
    const iv = buf.subarray(1, 1 + IV_LEN);
    const tag = buf.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
    const enc = buf.subarray(1 + IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, dataKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
      'utf8',
    );
  }

  /** Encrypts an optional value (null/undefined pass through as null). */
  static encryptOptional(plaintext?: string | null): string | null {
    return plaintext == null || plaintext === ''
      ? null
      : this.encrypt(plaintext);
  }

  /** Decrypts an optional value (null passes through). */
  static decryptOptional(payload?: string | null): string | null {
    return payload == null ? null : this.decrypt(payload);
  }

  // ── Masking (for callers WITHOUT `hrm:employee:read_pii`) ────────
  // Policy per PII sensitivity: critical identifiers are fully masked;
  // bank account keeps the conventional last-4; names keep the first
  // token so lists remain humanly usable.

  /** Fully masked — no decryption performed. For DOB / ID / tax / social-insurance numbers. */
  static maskFull(payload?: string | null): string | null {
    return payload == null ? null : '••••';
  }

  /** Last 4 visible, rest masked — for bank account numbers. */
  static maskTail(payload?: string | null): string | null {
    if (payload == null) return null;
    const plain = this.decrypt(payload);
    if (plain.length <= 4) return '••••';
    return '••••' + plain.slice(-4);
  }

  /** First name token visible, rest masked — for full names in list views. */
  static maskName(payload?: string | null): string | null {
    if (payload == null) return null;
    const plain = this.decrypt(payload);
    const first = plain.trim().split(/\s+/)[0] ?? '';
    return first ? `${first} ••••` : '••••';
  }
}
