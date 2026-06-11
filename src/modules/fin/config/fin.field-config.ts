import { FieldConfig } from '../../../common/utils/field-selector.js';

// Role keys must match the seeded role names (see org/tenant.service.ts):
// tenant_owner, tenant_admin, manager, staff, viewer.

const ACCOUNT_BASE = [
  'id',
  'accountCode',
  'accountName',
  'accountType',
  'normalBalance',
  'isGroup',
  'isActive',
];
const ACCOUNT_FULL = [...ACCOUNT_BASE, 'parentCode'];
export const ACCOUNT_FIELD_CONFIG: FieldConfig = {
  defaultFields: ACCOUNT_BASE,
  allowedFields: {
    tenant_owner: ACCOUNT_FULL,
    tenant_admin: ACCOUNT_FULL,
    manager: ACCOUNT_FULL,
    staff: ACCOUNT_BASE,
    viewer: ACCOUNT_BASE,
  },
};

const JOURNAL_BASE = [
  'id',
  'batchNumber',
  'journalDate',
  'status',
  'sourceType',
  'totalDebit',
  'totalCredit',
  'description',
  'createdAt',
];
const JOURNAL_FULL = [
  ...JOURNAL_BASE,
  'reference',
  'sourceId',
  'reversalOf',
  'postedBy',
  'postedAt',
  'createdBy',
  'updatedAt',
];
export const JOURNAL_BATCH_FIELD_CONFIG: FieldConfig = {
  defaultFields: JOURNAL_BASE,
  allowedFields: {
    tenant_owner: JOURNAL_FULL,
    tenant_admin: JOURNAL_FULL,
    manager: JOURNAL_FULL,
    staff: JOURNAL_BASE,
    viewer: JOURNAL_BASE,
  },
};

const INVOICE_BASE = [
  'id',
  'invoiceNumber',
  'invoiceType',
  'partyId',
  'partyType',
  'status',
  'invoiceDate',
  'dueDate',
  'grandTotal',
  'amountPaid',
  'balanceDue',
  'createdAt',
];
const INVOICE_FULL = [
  ...INVOICE_BASE,
  'sourceId',
  'currency',
  'subTotal',
  'taxAmount',
  'notes',
  'createdBy',
  'updatedAt',
];
export const INVOICE_FIELD_CONFIG: FieldConfig = {
  defaultFields: INVOICE_BASE,
  allowedFields: {
    tenant_owner: INVOICE_FULL,
    tenant_admin: INVOICE_FULL,
    manager: INVOICE_FULL,
    staff: INVOICE_BASE,
    viewer: INVOICE_BASE,
  },
};

const PAYMENT_BASE = [
  'id',
  'paymentNumber',
  'direction',
  'counterpartyId',
  'counterpartyType',
  'amount',
  'allocatedAmount',
  'paymentMethod',
  'paymentDate',
  'status',
  'createdAt',
];
const PAYMENT_FULL = [
  ...PAYMENT_BASE,
  'currency',
  'bankReference',
  'journalBatchId',
  'notes',
  'createdBy',
  'updatedAt',
];
export const PAYMENT_FIELD_CONFIG: FieldConfig = {
  defaultFields: PAYMENT_BASE,
  allowedFields: {
    tenant_owner: PAYMENT_FULL,
    tenant_admin: PAYMENT_FULL,
    manager: PAYMENT_FULL,
    staff: PAYMENT_BASE,
    viewer: PAYMENT_BASE,
  },
};
