import { DocumentSequenceService } from './document-sequence.service.js';

const TENANT_ID = '0e3b4f1a-2c5d-4e6f-8a9b-0c1d2e3f4a5b';

function buildDb(row?: Partial<Record<string, unknown>>) {
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue(
      row === undefined
        ? []
        : [
            {
              prefix: 'PO',
              separator: '-',
              includeYear: true,
              yearFormat: 'YYYY',
              padding: 5,
              lastNumber: 1,
              ...row,
            },
          ],
    ),
  };
}

describe('DocumentSequenceService', () => {
  const year = new Date().getFullYear();

  it('formats the claimed number with prefix, year and padding', async () => {
    const db = buildDb({ lastNumber: 42 });
    const service = new DocumentSequenceService(db as any);
    await expect(service.getNextNumber(TENANT_ID, 'PO')).resolves.toBe(
      `PO-${year}-00042`,
    );
    // ensure-row INSERT (ON CONFLICT DO NOTHING) then atomic UPDATE..RETURNING
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('respects includeYear=false and YY year format', async () => {
    const db = buildDb({ includeYear: false, lastNumber: 7 });
    const service = new DocumentSequenceService(db as any);
    await expect(service.getNextNumber(TENANT_ID, 'PO')).resolves.toBe(
      'PO-00007',
    );

    const dbYY = buildDb({ yearFormat: 'YY', lastNumber: 7, padding: 3 });
    const serviceYY = new DocumentSequenceService(dbYY as any);
    await expect(serviceYY.getNextNumber(TENANT_ID, 'PO')).resolves.toBe(
      `PO-${String(year).slice(-2)}-007`,
    );
  });

  it('uses the provided transaction client instead of the injected prisma', async () => {
    const prisma = buildDb({ lastNumber: 1 });
    const tx = buildDb({ lastNumber: 9 });
    const service = new DocumentSequenceService(prisma as any);
    await expect(
      service.getNextNumber(TENANT_ID, 'SO', undefined, tx as any),
    ).resolves.toBe(`PO-${year}-00009`);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('throws when the sequence row cannot be claimed', async () => {
    const db = buildDb(undefined);
    const service = new DocumentSequenceService(db as any);
    await expect(service.getNextNumber(TENANT_ID, 'PO')).rejects.toThrow(
      /Document sequence missing/,
    );
  });
});
