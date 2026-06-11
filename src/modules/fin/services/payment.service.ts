import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';
import { PAYMENT_FIELD_CONFIG } from '../config/fin.field-config.js';
import { JournalBatchService } from './journal-batch.service.js';
import { CreatePaymentDto, PaymentQueryDto } from '../dto/payment.dto.js';

const PAYMENT_SORTABLE = [
  'paymentNumber',
  'direction',
  'amount',
  'allocatedAmount',
  'paymentMethod',
  'paymentDate',
  'status',
  'createdAt',
  'updatedAt',
] as const;

const dec = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: DocumentSequenceService,
    private readonly journals: JournalBatchService,
  ) {}

  // ── FIN-003: Create payment with optional allocations ─────────

  async create(tenantId: string, userId: string, dto: CreatePaymentDto) {
    this.assertDirectionMatchesCounterparty(
      dto.direction,
      dto.counterpartyType,
    );

    return this.prisma.$transaction(async (tx) => {
      await this.assertCounterparty(
        tx,
        tenantId,
        dto.counterpartyType,
        dto.counterpartyId,
      );

      const allocations = dto.allocations ?? [];
      const grouped = this.groupAllocationsByInvoice(allocations);
      const totalAllocated = allocations
        .reduce((s, a) => s.add(dec(a.allocatedAmount)), dec(0))
        .toDecimalPlaces(2);
      if (totalAllocated.gt(dec(dto.amount).toDecimalPlaces(2))) {
        throw new BadRequestException('FIN_PAYMENT_TOTAL_EXCEEDS');
      }

      for (const [invoiceId, allocated] of grouped) {
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId, tenantId },
          select: {
            id: true,
            balanceDue: true,
            partyId: true,
            partyType: true,
            invoiceType: true,
          },
        });
        if (!invoice)
          throw new NotFoundException(`FIN_INVOICE_NOT_FOUND: ${invoiceId}`);
        this.assertInvoiceMatchesPayment(
          invoice,
          dto.direction,
          dto.counterpartyId,
        );
        if (allocated.gt(dec(invoice.balanceDue))) {
          throw new BadRequestException(
            `FIN_PAYMENT_ALLOCATION_EXCEEDS: invoice ${invoiceId}`,
          );
        }
      }

      const paymentNumber = await this.sequences.getNextNumber(
        tenantId,
        'PAY',
        undefined,
        tx,
      );

      return tx.payment.create({
        data: {
          tenantId,
          paymentNumber,
          direction: dto.direction,
          counterpartyId: dto.counterpartyId,
          counterpartyType: dto.counterpartyType,
          amount: dto.amount,
          allocatedAmount: totalAllocated.toNumber(),
          paymentMethod: dto.paymentMethod,
          paymentDate: new Date(dto.paymentDate),
          bankReference: dto.bankReference ?? null,
          status: 'draft',
          notes: dto.notes ?? null,
          createdBy: userId,
          allocations: {
            create: allocations.map((a) => ({
              invoiceId: a.invoiceId,
              allocatedAmount: a.allocatedAmount,
            })),
          },
        },
        include: { allocations: true },
      });
    });
  }

  private assertDirectionMatchesCounterparty(
    direction: string,
    counterpartyType: string,
  ) {
    const expected = direction === 'inbound' ? 'customer' : 'supplier';
    if (counterpartyType !== expected) {
      throw new BadRequestException('FIN_PAYMENT_DIRECTION_MISMATCH');
    }
  }

  /** Inbound receipts settle AR (sales) invoices of the same customer;
   *  outbound disbursements settle AP (purchase) invoices of the same supplier. */
  private assertInvoiceMatchesPayment(
    invoice: { id: string; partyId: string; invoiceType: string },
    direction: string,
    counterpartyId: string,
  ) {
    const expectedType = direction === 'inbound' ? 'sales' : 'purchase';
    if (
      invoice.partyId !== counterpartyId ||
      invoice.invoiceType !== expectedType
    ) {
      throw new BadRequestException(
        `FIN_PAYMENT_INVOICE_MISMATCH: invoice ${invoice.id}`,
      );
    }
  }

  /** Sums allocations per invoiceId so duplicates are validated as one total. */
  private groupAllocationsByInvoice(
    allocations: {
      invoiceId: string;
      allocatedAmount: number | Prisma.Decimal;
    }[],
  ): Map<string, Prisma.Decimal> {
    const grouped = new Map<string, Prisma.Decimal>();
    for (const a of allocations) {
      const current = grouped.get(a.invoiceId) ?? dec(0);
      grouped.set(
        a.invoiceId,
        current.add(dec(a.allocatedAmount)).toDecimalPlaces(2),
      );
    }
    return grouped;
  }

  private async assertCounterparty(
    tx: any,
    tenantId: string,
    type: string,
    id: string,
  ) {
    if (type === 'customer') {
      const c = await tx.customer.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!c) throw new NotFoundException('SAL_CUSTOMER_NOT_FOUND');
    } else {
      const s = await tx.supplier.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!s) throw new NotFoundException('PUR_SUPPLIER_NOT_FOUND');
    }
  }

  // ── FIN-003: Post payment — apply allocations + auto-journal ──

  async post(tenantId: string, id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { id, tenantId },
        include: { allocations: true },
      });
      if (!payment) throw new NotFoundException('FIN_PAYMENT_NOT_FOUND');
      if (payment.status !== 'draft')
        throw new ConflictException('FIN_PAYMENT_NOT_DRAFT');

      // Race-safe claim FIRST: a concurrent post loses here and no side
      // effects (allocations / journal / credit) are applied twice.
      const claimed = await tx.payment.updateMany({
        where: { id, tenantId, status: 'draft' },
        data: { status: 'posted' },
      });
      if (claimed.count === 0)
        throw new ConflictException('FIN_PAYMENT_NOT_DRAFT');

      // Apply allocations to invoices (summed per invoice, re-validated now)
      const grouped = this.groupAllocationsByInvoice(payment.allocations);
      for (const [invoiceId, allocated] of grouped) {
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId, tenantId },
          select: {
            id: true,
            balanceDue: true,
            partyId: true,
            invoiceType: true,
          },
        });
        if (!invoice)
          throw new NotFoundException(`FIN_INVOICE_NOT_FOUND: ${invoiceId}`);
        this.assertInvoiceMatchesPayment(
          invoice,
          payment.direction,
          payment.counterpartyId,
        );
        if (allocated.gt(dec(invoice.balanceDue))) {
          throw new BadRequestException(
            `FIN_PAYMENT_ALLOCATION_EXCEEDS: invoice ${invoiceId}`,
          );
        }

        const allocNum = allocated.toNumber();
        // Guarded conditional update — refuses (instead of clamping) if the
        // balance changed concurrently and would go negative.
        const applied = await tx.invoice.updateMany({
          where: { id: invoiceId, tenantId, balanceDue: { gte: allocNum } },
          data: {
            amountPaid: { increment: allocNum },
            balanceDue: { decrement: allocNum },
          },
        });
        if (applied.count === 0) {
          throw new BadRequestException(
            `FIN_PAYMENT_ALLOCATION_EXCEEDS: invoice ${invoiceId}`,
          );
        }

        // Re-read to derive the correct status transition.
        const after = await tx.invoice.findFirst({
          where: { id: invoiceId, tenantId },
          select: { id: true, balanceDue: true },
        });
        if (!after || dec(after.balanceDue).lt(0)) {
          throw new BadRequestException(
            `FIN_PAYMENT_ALLOCATION_EXCEEDS: invoice ${invoiceId}`,
          );
        }
        const status = dec(after.balanceDue).lte(0) ? 'paid' : 'partially_paid';
        await tx.invoice.updateMany({
          where: { id: invoiceId, tenantId },
          data: { status },
        });
      }

      // Auto-journal: inbound → Dr 112 / Cr 131; outbound → Dr 331 / Cr 112
      const amountDec = dec(payment.amount).toDecimalPlaces(2);
      const amount = amountDec.toNumber();
      const entries =
        payment.direction === 'inbound'
          ? [
              {
                accountCode: '112',
                description: 'Thu tiền',
                debitAmount: amount,
                creditAmount: 0,
              },
              {
                accountCode: '131',
                description: 'Giảm phải thu',
                debitAmount: 0,
                creditAmount: amount,
              },
            ]
          : [
              {
                accountCode: '331',
                description: 'Giảm phải trả',
                debitAmount: amount,
                creditAmount: 0,
              },
              {
                accountCode: '112',
                description: 'Chi tiền',
                debitAmount: 0,
                creditAmount: amount,
              },
            ];

      const journal = await this.journals.createPosted(tx, tenantId, userId, {
        description: `Payment ${payment.paymentNumber}`,
        journalDate: payment.paymentDate,
        sourceType: payment.direction === 'inbound' ? 'sales' : 'purchase',
        sourceId: payment.id,
        entries,
      });

      // Settling open invoices reduces the counterparty's outstanding credit:
      // inbound receipt → customer.creditUsed, outbound payment → supplier.creditUsed.
      if (
        payment.direction === 'inbound' &&
        payment.counterpartyType === 'customer'
      ) {
        await this.decrementCreditUsed(
          tx.customer,
          tenantId,
          payment.counterpartyId,
          amount,
        );
      } else if (
        payment.direction === 'outbound' &&
        payment.counterpartyType === 'supplier'
      ) {
        await this.decrementCreditUsed(
          tx.supplier,
          tenantId,
          payment.counterpartyId,
          amount,
        );
      }

      return tx.payment.update({
        where: { id },
        data: { journalBatchId: journal.id },
        include: { allocations: true },
      });
    });
  }

  /** Guarded decrement that never drives creditUsed below zero. */
  private async decrementCreditUsed(
    delegate: {
      updateMany: (args: any) => Promise<{ count: number }>;
    },
    tenantId: string,
    counterpartyId: string,
    amount: number,
  ) {
    const decremented = await delegate.updateMany({
      where: { id: counterpartyId, tenantId, creditUsed: { gte: amount } },
      data: { creditUsed: { decrement: amount } },
    });
    if (decremented.count === 0) {
      // creditUsed < amount (or row gone) — floor at zero instead of going negative.
      await delegate.updateMany({
        where: { id: counterpartyId, tenantId },
        data: { creditUsed: 0 },
      });
    }
  }

  // ── Queries ───────────────────────────────────────────────────

  async findAll(tenantId: string, query: PaymentQueryDto, userRoles: string[]) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      PAYMENT_FIELD_CONFIG,
    );
    const {
      page = 1,
      limit = 20,
      sortOrder = 'desc',
      direction,
      counterpartyId,
      status,
    } = query;
    const sortBy = safeSortBy(query.sortBy, PAYMENT_SORTABLE, 'paymentDate');

    const where: any = {
      tenantId,
      ...(direction && { direction }),
      ...(counterpartyId && { counterpartyId }),
      ...(status && { status }),
    };

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return PaginatedResponseDto.create(data, total, page, limit);
  }

  async findOne(tenantId: string, id: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, tenantId },
      include: { allocations: true },
    });
    if (!payment) throw new NotFoundException('FIN_PAYMENT_NOT_FOUND');
    return payment;
  }
}
