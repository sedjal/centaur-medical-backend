import { sendMfaCode } from '../src/mailer';

// Avoid real DB write in unit test by mocking
jest.mock('@centaur/shared', () => ({
  createDb: jest.fn(),
  getDb: jest.fn(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: () => ({ insert: jest.fn().mockResolvedValue(undefined) }),
    // knex style call
  })),
}));

// getDb is used as function: getDb()('notifications')
jest.mock('@centaur/shared', () => {
  const insert = jest.fn().mockResolvedValue(undefined);
  const knexFn = Object.assign(
    jest.fn(() => ({ insert })),
    { table: jest.fn(() => ({ insert })) }
  );
  return {
    createDb: jest.fn(),
    getDb: jest.fn(() => knexFn),
  };
});

describe('Notification mailer', () => {
  it('sendMfaCode logs when SMTP not configured', async () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const result = await sendMfaCode({
      userId: '11111111-1111-1111-1111-111111111111',
      email: 'sedjalkhouloud@gmail.com',
      code: '123456',
      firstName: 'Khouloud',
    });
    expect(result.sent).toBe(false);
  });
});
