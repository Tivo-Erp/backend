import { FieldConfig } from '../../../common/utils/field-selector.js';

const LEAD_BASE = [
  'id',
  'companyName',
  'contactName',
  'email',
  'phone',
  'source',
  'status',
  'score',
  'assignedTo',
  'createdAt',
];
const LEAD_FULL = [
  ...LEAD_BASE,
  'estimatedValue',
  'customerId',
  'convertedAt',
  'lostReason',
  'notes',
  'createdBy',
  'updatedAt',
];

export const LEAD_FIELD_CONFIG: FieldConfig = {
  defaultFields: LEAD_BASE,
  allowedFields: {
    tenant_owner: LEAD_FULL,
    tenant_admin: LEAD_FULL,
    manager: LEAD_FULL,
    staff: LEAD_FULL,
    viewer: LEAD_BASE,
  },
};

const OPP_BASE = [
  'id',
  'name',
  'customerId',
  'leadId',
  'stageId',
  'expectedRevenue',
  'currency',
  'status',
  'assignedTo',
  'createdAt',
];
const OPP_FULL = [
  ...OPP_BASE,
  'expectedCloseDate',
  'wonAt',
  'lostReason',
  'notes',
  'createdBy',
  'updatedAt',
];

export const OPPORTUNITY_FIELD_CONFIG: FieldConfig = {
  defaultFields: OPP_BASE,
  allowedFields: {
    tenant_owner: OPP_FULL,
    tenant_admin: OPP_FULL,
    manager: OPP_FULL,
    staff: OPP_BASE,
    viewer: OPP_BASE,
  },
};

const TICKET_BASE = [
  'id',
  'ticketNumber',
  'customerId',
  'subject',
  'priority',
  'status',
  'category',
  'assignedTo',
  'slaDueAt',
  'createdAt',
];
const TICKET_FULL = [
  ...TICKET_BASE,
  'description',
  'firstResponseAt',
  'resolvedAt',
  'satisfactionScore',
  'createdBy',
  'updatedAt',
];

export const TICKET_FIELD_CONFIG: FieldConfig = {
  defaultFields: TICKET_BASE,
  allowedFields: {
    tenant_owner: TICKET_FULL,
    tenant_admin: TICKET_FULL,
    manager: TICKET_FULL,
    staff: TICKET_FULL,
    viewer: TICKET_BASE,
  },
};
