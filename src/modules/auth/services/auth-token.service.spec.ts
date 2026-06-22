import { Test, TestingModule } from '@nestjs/testing';
import { AuthTokenService } from './auth-token.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';

const mockPrisma = {
  authToken: {
    create: jest.fn(),
    updateMany: jest.fn(),
    findFirst: jest.fn(),
  },
};

describe('AuthTokenService (SEC-001)', () => {
  let service: AuthTokenService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthTokenService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(AuthTokenService);
  });

  it('issues a token storing only its hash (raw never persisted)', async () => {
    mockPrisma.authToken.create.mockResolvedValue({});
    const raw = await service.issue('user-1', 'password_reset', 1800);

    expect(raw).toEqual(expect.any(String));
    const data = mockPrisma.authToken.create.mock.calls[0][0].data;
    expect(data.tokenHash).not.toEqual(raw);
    expect(data.tokenHash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
    expect(data.userId).toBe('user-1');
    expect(data.type).toBe('password_reset');
  });

  it('consume returns the owning userId when the claim succeeds', async () => {
    mockPrisma.authToken.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.authToken.findFirst.mockResolvedValue({ userId: 'user-9' });

    const userId = await service.consume('some-raw-token', 'email_verify');
    expect(userId).toBe('user-9');
    // atomic claim on usedAt: null
    expect(mockPrisma.authToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: 'email_verify', usedAt: null }),
      }),
    );
  });

  it('consume throws AUTH_TOKEN_INVALID when nothing was claimed', async () => {
    mockPrisma.authToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.consume('bad', 'password_reset'),
    ).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
    expect(mockPrisma.authToken.findFirst).not.toHaveBeenCalled();
  });
});
