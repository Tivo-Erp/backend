import { FieldConfig } from '../../../common/utils/field-selector.js';

const INSP_BASE = [
  'id',
  'inspectionNumber',
  'sourceType',
  'sourceId',
  'itemId',
  'totalQty',
  'acceptedQty',
  'rejectedQty',
  'status',
  'createdAt',
];
const INSP_FULL = [...INSP_BASE, 'inspectorId', 'inspectorNotes', 'updatedAt'];

export const QC_INSPECTION_FIELD_CONFIG: FieldConfig = {
  defaultFields: INSP_BASE,
  allowedFields: {
    tenant_owner: INSP_FULL,
    tenant_admin: INSP_FULL,
    manager: INSP_FULL,
    staff: INSP_FULL,
    viewer: INSP_BASE,
  },
};

const NCR_BASE = [
  'id',
  'ncrNumber',
  'inspectionId',
  'description',
  'disposition',
  'assignedTo',
  'status',
  'createdAt',
];
const NCR_FULL = [...NCR_BASE, 'createdBy', 'updatedAt'];

export const NCR_FIELD_CONFIG: FieldConfig = {
  defaultFields: NCR_BASE,
  allowedFields: {
    tenant_owner: NCR_FULL,
    tenant_admin: NCR_FULL,
    manager: NCR_FULL,
    staff: NCR_BASE,
    viewer: NCR_BASE,
  },
};
