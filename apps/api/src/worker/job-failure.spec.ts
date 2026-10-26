import { Prisma } from '@prisma/client';
import { isTransient } from './job-failure';

const prismaError = (code: string) => new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: '6' });

describe('isTransient', () => {
  it('treats pool timeouts and lost connections as transient', () => {
    expect(isTransient(prismaError('P2024'))).toBe(true); // pool timeout
    expect(isTransient(prismaError('P1001'))).toBe(true); // cannot reach database
    expect(isTransient(prismaError('P1017'))).toBe(true); // server closed connection
  });

  it('treats data errors and unknown errors as permanent', () => {
    expect(isTransient(prismaError('P2002'))).toBe(false);
    expect(isTransient(new Error('boom'))).toBe(false);
  });
});
