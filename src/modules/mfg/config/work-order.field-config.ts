import { FieldConfig } from '../../../common/utils/field-selector.js';

const BASE_FIELDS = [
  'id',
  'woNumber',
  'itemId',
  'bomId',
  'warehouseId',
  'plannedQty',
  'producedQty',
  'rejectedQty',
  'uom',
  'status',
  'plannedStartDate',
  'plannedEndDate',
  'priority',
  'createdAt',
];

const FULL_FIELDS = [
  ...BASE_FIELDS,
  'actualStartDate',
  'actualEndDate',
  'notes',
  'createdBy',
  'updatedAt',
];

export const WORK_ORDER_FIELD_CONFIG: FieldConfig = {
  defaultFields: BASE_FIELDS,
  allowedFields: {
    tenant_owner: FULL_FIELDS,
    tenant_admin: FULL_FIELDS,
    manager: FULL_FIELDS,
    staff: [...BASE_FIELDS, 'notes'],
    viewer: BASE_FIELDS,
  },
};
