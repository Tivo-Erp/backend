import {
  generateTotpSecret,
  generateTotp,
  verifyTotp,
  buildOtpAuthUrl,
} from './totp.js';

describe('TOTP (SEC-001)', () => {
  it('generates a valid base32 secret', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  it('round-trips: a freshly generated code verifies', () => {
    const secret = generateTotpSecret();
    const code = generateTotp(secret);
    expect(verifyTotp(code, secret)).toBe(true);
  });

  it('rejects an incorrect code', () => {
    const secret = generateTotpSecret();
    const code = generateTotp(secret);
    const wrong = code === '000000' ? '111111' : '000000';
    expect(verifyTotp(wrong, secret)).toBe(false);
  });

  it('rejects malformed codes', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp('abc', secret)).toBe(false);
    expect(verifyTotp('12345', secret)).toBe(false);
    expect(verifyTotp('', secret)).toBe(false);
  });

  it('absorbs ±1 step of clock drift within the window', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000;
    const prevStepCode = generateTotp(secret, now - 30);
    expect(verifyTotp(prevStepCode, secret, 1, now)).toBe(true);
    // outside the window it fails
    const farCode = generateTotp(secret, now - 300);
    expect(verifyTotp(farCode, secret, 1, now)).toBe(false);
  });

  it('builds a standard otpauth:// provisioning URL', () => {
    const url = buildOtpAuthUrl('ERP', 'owner@acme.com', 'JBSWY3DPEHPK3PXP');
    expect(url).toContain('otpauth://totp/');
    expect(url).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(url).toContain('issuer=ERP');
  });
});
