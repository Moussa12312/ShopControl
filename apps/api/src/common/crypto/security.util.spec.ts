import {
  buildTotpOtpAuthUri,
  canonicalJson,
  computeAuditEntryHash,
  decryptAes256Gcm,
  encryptAes256Gcm,
  generateTotpCode,
  generateTotpSecret,
  verifyTotpCode,
} from './security.util';

describe('security.util', () => {
  it('génère et vérifie un code TOTP RFC 6238 valide', () => {
    const secret = generateTotpSecret();
    const now = 1_763_510_400_000;
    const code = generateTotpCode(secret, now);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotpCode(secret, code, 1, now)).toBe(true);
    expect(verifyTotpCode(secret, '000000', 0, now)).toBe(code === '000000');

    const uri = buildTotpOtpAuthUri('owner@shop.ml', secret);
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain(`secret=${secret}`);
  });

  it('chiffre et déchiffre un secret avec AES-256-GCM', () => {
    const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptAes256Gcm(secret, key);
    expect(encrypted).not.toContain(secret);
    expect(decryptAes256Gcm(encrypted, key)).toBe(secret);
  });

  it('calcule une empreinte SHA-256 déterministe indépendante de l’ordre des clés JSON', () => {
    const h1 = computeAuditEntryHash('GENESIS', { b: 2, a: 1, nested: { y: true, x: 'ok' } });
    const h2 = computeAuditEntryHash('GENESIS', { a: 1, nested: { x: 'ok', y: true }, b: 2 });
    expect(h1).toBe(h2);
    expect(canonicalJson({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
  });
});
