import { FieldConfig } from '../../../common/utils/field-selector.js';

const BASE_FIELDS = [
  'id',
  'poNumber',
  'supplierId',
  'warehouseId',
  'status',
  'orderDate',
  'expectedDate',
  'currency',
  'grandTotal',
  'createdAt',
];

const FULL_FIELDS = [
  ...BASE_FIELDS,
  'branchId',
  'paymentTermsDays',
  'subTotal',
  'discountAmount',
  'taxAmount',
  'notes',
  'approvedBy',
  'approvedAt',
  'createdBy',
  'updatedBy',
  'updatedAt',
];

export const PURCHASE_ORDER_FIELD_CONFIG: FieldConfig = {
  defaultFields: BASE_FIELDS,
  allowedFields: {
    tenant_owner: FULL_FIELDS,
    tenant_admin: FULL_FIELDS,
    manager: FULL_FIELDS,
    staff: [...BASE_FIELDS, 'notes', 'subTotal', 'discountAmount', 'taxAmount'],
    viewer: BASE_FIELDS,
  },
};
