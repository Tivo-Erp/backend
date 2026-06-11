import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';
import { INVOICE_FIELD_CONFIG } from '../config/fin.field-config.js';
import { CreateInvoiceDto, InvoiceQueryDto } from '../dto/invoice.dto.js';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: DocumentSequenceService,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateInvoiceDto) {
    return this.prisma.$transaction(async (tx) => {
      const partyType = dto.invoiceType === 'sales' ? 'customer' : 'supplier';

      if (partyType === 'customer') {
        const c = await tx.customer.findFirst({
          where: { id: dto.partyId, tenantId },
          select: { id: true },
        });
        if (!c) throw new NotFoundException('SAL_CUSTOMER_NOT_FOUND');
      } else {
        const s = await tx.supplier.findFirst({
          where: { id: dto.partyId, tenantId },
          select: { id: true },
        });
        if (!s) throw new NotFoundException('PUR_SUPPLIER_NOT_FOUND');
      }

      const taxAmount = round2(dto.taxAmount ?? 0);
      const grandTotal = round2(dto.subTotal + taxAmount);
      const invoiceNumber = await this.sequences.getNextNumber(
        tenantId,
        'INV',
        undefined,
        tx,
      );

      return tx.invoice.create({
        data: {
          tenantId,
          invoiceNumber,
          invoiceType: dto.invoiceType,
          partyId: dto.partyId,
          partyType,
          sourceId: dto.sourceId ?? null,
          status: 'open',
          invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : undefined,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          subTotal: dto.subTotal,
          taxAmount,
          grandTotal,
          amountPaid: 0,
          balanceDue: grandTotal,
          notes: dto.notes ?? null,
          createdBy: userId,
        },
      });
    });
  }

  async findAll(tenantId: string, query: InvoiceQueryDto, userRoles: string[]) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      INVOICE_FIELD_CONFIG,
    );
    const {
      page = 1,
      limit = 20,
      sortOrder = 'desc',
      invoiceType,
      partyId,
      status,
    } = query;
    const sortBy = safeSortBy(
      query.sortBy,
      [
        'invoiceNumber',
        'invoiceType',
        'status',
        'invoiceDate',
        'dueDate',
        'grandTotal',
        'amountPaid',
        'balanceDue',
        'createdAt',
        'updatedAt',
      ],
      'invoiceDate',
    );

    const where: any = {
      tenantId,
      ...(invoiceType && { invoiceType }),
      ...(partyId && { partyId }),
      ...(status && { status }),
    };

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return PaginatedResponseDto.create(data, total, page, limit);
  }

  async findOne(tenantId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, tenantId },
      include: { allocations: true },
    });
    if (!invoice) throw new NotFoundException('FIN_INVOICE_NOT_FOUND');
    return invoice;
  }
}
