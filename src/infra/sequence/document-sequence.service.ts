import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class DocumentSequenceService {
  constructor(private readonly prisma: PrismaService) {}

  async getNextNumber(
    tenantId: string,
    documentType: string,
    branchId?: string,
  ): Promise<string> {
    const now = new Date();
    const currentYear = now.getFullYear();

    const sequence = await this.prisma.documentSequence.findFirst({
      where: { tenantId, documentType, branchId: branchId || null },
    });

    if (!sequence) {
      throw new Error(
        `Document sequence not found for type ${documentType}`,
      );
    }

    let nextNumber = sequence.lastNumber + 1;

    if (sequence.resetYearly && sequence.lastResetYear !== currentYear) {
      nextNumber = 1;
    }

    await this.prisma.documentSequence.update({
      where: { id: sequence.id },
      data: {
        lastNumber: nextNumber,
        lastResetYear: currentYear,
      },
    });

    const yearPart = sequence.includeYear
      ? sequence.yearFormat === 'YY'
        ? String(currentYear).slice(-2)
        : String(currentYear)
      : '';

    const numberPart = String(nextNumber).padStart(sequence.padding, '0');
    const parts = [sequence.prefix, yearPart, numberPart].filter(Boolean);
    return parts.join(sequence.separator);
  }
}
