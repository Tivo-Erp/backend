import { PiiCrypto } from './pii-crypto.js';

describe('PiiCrypto', () => {
  const ORIGINAL_KEY = process.env.PII_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.PII_ENCRYPTION_KEY = 'unit-test-passphrase-32-chars!!';
  });

  afterAll(() => {
    process.env.PII_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  describe('encrypt / decrypt', () => {
    it('round-trips utf8 plaintext', () => {
      const enc = PiiCrypto.encrypt('Nguyễn Văn An — 079123456789');
      expect(enc).not.toContain('Nguyễn');
      expect(PiiCrypto.decrypt(enc)).toBe('Nguyễn Văn An — 079123456789');
    });

    it('produces distinct ciphertexts for the same plaintext (random IV)', () => {
      expect(PiiCrypto.encrypt('same')).not.toBe(PiiCrypto.encrypt('same'));
    });

    it('rejects a tampered payload (auth tag verification)', () => {
      const enc = PiiCrypto.encrypt('sensitive');
      const buf = Buffer.from(enc, 'base64');
      buf[buf.length - 1] ^= 0xff; // flip a ciphertext bit
      expect(() => PiiCrypto.decrypt(buf.toString('base64'))).toThrow();
    });

    it('rejects an unknown version / truncated payload', () => {
      expect(() => PiiCrypto.decrypt(Buffer.from([0x01, 1, 2, 3]).toString('base64'))).toThrow(
        /PII_PAYLOAD_INVALID/,
      );
    });

    it('refuses to operate without a sufficiently long key', () => {
      process.env.PII_ENCRYPTION_KEY = 'short';
      expect(() => PiiCrypto.encrypt('x')).toThrow(/PII_ENCRYPTION_KEY/);
      delete process.env.PII_ENCRYPTION_KEY;
      expect(() => PiiCrypto.encrypt('x')).toThrow(/PII_ENCRYPTION_KEY/);
    });

    it('passes null/empty through encryptOptional/decryptOptional', () => {
      expect(PiiCrypto.encryptOptional(null)).toBeNull();
      expect(PiiCrypto.encryptOptional('')).toBeNull();
      expect(PiiCrypto.decryptOptional(null)).toBeNull();
      expect(PiiCrypto.decryptOptional(PiiCrypto.encryptOptional('v'))).toBe('v');
    });
  });

  describe('masking policy', () => {
    it('maskFull never reveals anything and skips decryption', () => {
      const enc = PiiCrypto.encrypt('1990-01-15');
      expect(PiiCrypto.maskFull(enc)).toBe('••••');
      expect(PiiCrypto.maskFull(null)).toBeNull();
      // works even on an undecryptable value — no decryption involved
      expect(PiiCrypto.maskFull('not-a-valid-payload')).toBe('••••');
    });

    it('maskTail reveals only the last 4 characters', () => {
      expect(PiiCrypto.maskTail(PiiCrypto.encrypt('0011002233445566'))).toBe('••••5566');
      expect(PiiCrypto.maskTail(PiiCrypto.encrypt('1234'))).toBe('••••');
      expect(PiiCrypto.maskTail(null)).toBeNull();
    });

    it('maskName reveals only the first name token', () => {
      expect(PiiCrypto.maskName(PiiCrypto.encrypt('Nguyễn Văn An'))).toBe('Nguyễn ••••');
      expect(PiiCrypto.maskName(PiiCrypto.encrypt('  '))).toBe('••••');
      expect(PiiCrypto.maskName(null)).toBeNull();
    });
  });
});
