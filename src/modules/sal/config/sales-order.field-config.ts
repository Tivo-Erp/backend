import { FieldConfig } from '../../../common/utils/field-selector.js';

const BASE_FIELDS = [
  'id',
  'soNumber',
  'customerId',
  'warehouseId',
  'status',
  'orderDate',
  'deliveryDate',
  'currency',
  'grandTotal',
  'createdAt',
];

const FULL_FIELDS = [
  ...BASE_FIELDS,
  'branchId',
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

export const SALES_ORDER_FIELD_CONFIG: FieldConfig = {
  defaultFields: BASE_FIELDS,
  allowedFields: {
    admin: FULL_FIELDS,
    owner: FULL_FIELDS,
    sales: FULL_FIELDS,
    sales_manager: FULL_FIELDS,
    warehouse_manager: [...BASE_FIELDS, 'notes'],
    viewer: BASE_FIELDS,
  },
};
