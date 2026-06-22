import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service.js';
import { PrismaService } from '../../infra/database/prisma.service.js';

const mockPrisma: { $queryRaw: jest.Mock; $transaction: jest.Mock } = {
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};
// Mirror the RLS-aware override: array form resolves every query promise.
mockPrisma.$transaction.mockImplementation((arg: unknown) =>
  Array.isArray(arg)
    ? Promise.all(arg)
    : (arg as (tx: unknown) => unknown)(mockPrisma),
);

const SUPER = { permissions: [], isSuperAdmin: true };

describe('SearchService (INF-004)', () => {
  let service: SearchService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(SearchService);
  });

  it('rejects queries shorter than 2 characters', async () => {
    await expect(
      service.search('t1', 'a', undefined, 20, SUPER),
    ).rejects.toMatchObject({
      code: 'SEARCH_QUERY_TOO_SHORT',
    });
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects unknown entity types', async () => {
    await expect(
      service.search('t1', 'acme', ['item', 'bogus'], 20, SUPER),
    ).rejects.toMatchObject({
      code: 'SEARCH_INVALID_TYPE',
    });
  });

  it('merges per-type hits ranked by ts_rank, capped by limit', async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([
        { id: 'i1', title: 'Acme Widget', subtitle: 'SKU1', rank: 0.2 },
      ])
      .mockResolvedValueOnce([
        { id: 'c1', title: 'Acme Corp', subtitle: 'C001', rank: 0.9 },
      ]);

    const res = await service.search('t1', 'acme', ['item', 'customer'], 10, {
      permissions: ['mat:item:read', 'sal:customer:read'],
      isSuperAdmin: false,
    });

    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(res.results[0]).toMatchObject({
      type: 'customer',
      id: 'c1',
      rank: 0.9,
    });
    expect(res.results[1]).toMatchObject({ type: 'item', id: 'i1' });
    expect(res.total).toBe(2);
  });

  it('silently drops types the caller lacks read permission on', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'i1', title: 'Acme Widget', subtitle: 'SKU1', rank: 0.2 },
    ]);

    const res = await service.search('t1', 'acme', ['item', 'customer'], 10, {
      permissions: ['mat:item:read'],
      isSuperAdmin: false,
    });

    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(res.results).toEqual([
      expect.objectContaining({ type: 'item', id: 'i1' }),
    ]);
  });

  it('returns empty results when no requested type is permitted', async () => {
    const res = await service.search('t1', 'acme', undefined, 10, {
      permissions: [],
      isSuperAdmin: false,
    });

    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    expect(res).toMatchObject({ total: 0, results: [] });
  });
});
