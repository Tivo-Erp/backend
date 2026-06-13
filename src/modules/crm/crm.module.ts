import { Module } from '@nestjs/common';
import { DocumentSequenceService } from '../../infra/sequence/document-sequence.service.js';
import {
  LeadController,
  OpportunityController,
  TicketController,
} from './controllers/crm.controller.js';
import { LeadService } from './services/lead.service.js';
import { OpportunityService } from './services/opportunity.service.js';
import { TicketService } from './services/ticket.service.js';

@Module({
  controllers: [LeadController, OpportunityController, TicketController],
  providers: [LeadService, OpportunityService, TicketService, DocumentSequenceService],
  exports: [LeadService, OpportunityService, TicketService],
})
export class CrmModule {}
