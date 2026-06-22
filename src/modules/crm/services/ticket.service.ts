import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { TICKET_FIELD_CONFIG } from '../config/crm.field-config.js';
import {
  CreateTicketDto,
  TicketQueryDto,
  UpdateTicketDto,
} from '../dto/crm.dto.js';

const TICKET_SORTABLE = [
  'createdAt',
  'updatedAt',
  'ticketNumber',
  'priority',
  'status',
] as const;

/** SLA resolution targets (hours) per priority — SRS_07 §1.3. */
const SLA_RESOLUTION_HOURS: Record<string, number> = {
  critical: 4,
  high: 8,
  medium: 24,
  low: 72,
};

@Injectable()
export class TicketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: DocumentSequenceService,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateTicketDto) {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: dto.customerId, tenantId },
        select: { id: true },
      });
      if (!customer) throw new NotFoundException('CRM_CUSTOMER_NOT_FOUND');

      const ticketNumber = await this.sequences.getNextNumber(
        tenantId,
        'TKT',
        undefined,
        tx,
      );
      const slaDueAt = new Date(
        Date.now() + (SLA_RESOLUTION_HOURS[dto.priority] ?? 24) * 3_600_000,
      );

      return tx.supportTicket.create({
        data: {
          tenantId,
          ticketNumber,
          customerId: dto.customerId,
          subject: dto.subject,
          description: dto.description,
          priority: dto.priority,
          category: dto.category,
          status: 'open',
          assignedTo: dto.assignedTo ?? null,
          slaDueAt,
          createdBy: userId,
        },
      });
    });
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdateTicketDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.findFirst({
        where: { id, tenantId },
      });
      if (!ticket) throw new NotFoundException('CRM_TICKET_NOT_FOUND');
      if (ticket.status === 'closed') {
        throw new ConflictException('CRM_TICKET_ALREADY_CLOSED');
      }

      const data: Prisma.SupportTicketUpdateInput = {};
      if (dto.assignedTo !== undefined) data.assignedTo = dto.assignedTo;
      if (dto.satisfactionScore !== undefined)
        data.satisfactionScore = dto.satisfactionScore;
      if (dto.status !== undefined) {
        data.status = dto.status;
        if (dto.status === 'resolved' && !ticket.resolvedAt)
          data.resolvedAt = new Date();
      }
      // First non-internal customer-facing touch stamps the SLA first-response time.
      // Internal notes do not count as a response to the customer.
      if (
        !ticket.firstResponseAt &&
        (dto.status === 'in_progress' || (dto.comment && !dto.isInternal))
      ) {
        data.firstResponseAt = new Date();
      }

      if (dto.comment) {
        await tx.ticketComment.create({
          data: {
            ticketId: id,
            body: dto.comment,
            isInternal: dto.isInternal ?? false,
            createdBy: userId,
          },
        });
      }

      await tx.supportTicket.update({ where: { id }, data });
      return tx.supportTicket.findFirst({
        where: { id, tenantId },
        include: { comments: true },
      });
    });
  }

  async findAll(tenantId: string, query: TicketQueryDto, userRoles: string[]) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      TICKET_FIELD_CONFIG,
    );
    const {
      page = 1,
      limit = 20,
      sortOrder = 'desc',
      customerId,
      status,
      priority,
      assignedTo,
    } = query;
    const sortBy = safeSortBy(query.sortBy, TICKET_SORTABLE);

    const where: Prisma.SupportTicketWhereInput = {
      tenantId,
      ...(customerId && { customerId }),
      ...(status && { status }),
      ...(priority && { priority }),
      ...(assignedTo && { assignedTo }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        select: { ...select, slaDueAt: true, status: true },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    const now = Date.now();
    const data = rows.map((t: Record<string, any>) => ({
      ...t,
      // SLA breach is derived, not stored (no scheduler yet).
      slaBreached:
        t.slaDueAt != null &&
        !['resolved', 'closed'].includes(t.status) &&
        new Date(t.slaDueAt).getTime() < now,
    }));
    return PaginatedResponseDto.create(data, total, page, limit);
  }

  async findOne(tenantId: string, id: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, tenantId },
      include: { comments: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) throw new NotFoundException('CRM_TICKET_NOT_FOUND');
    return ticket;
  }
}
