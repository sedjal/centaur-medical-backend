import * as argon2 from 'argon2';

describe('Argon2 password hashing', () => {
  it('hashes and verifies Admin123!', async () => {
    const hash = await argon2.hash('Admin123!', { type: argon2.argon2id });
    expect(hash.startsWith('$argon2')).toBe(true);
    await expect(argon2.verify(hash, 'Admin123!')).resolves.toBe(true);
    await expect(argon2.verify(hash, 'wrong')).resolves.toBe(false);
  });
});
