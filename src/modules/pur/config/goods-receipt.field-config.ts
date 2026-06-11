import { FieldConfig } from '../../../common/utils/field-selector.js';

const BASE_FIELDS = [
  'id',
  'grnNumber',
  'poId',
  'warehouseId',
  'receiptDate',
  'createdAt',
];

const FULL_FIELDS = [...BASE_FIELDS, 'notes', 'createdBy'];

export const GOODS_RECEIPT_FIELD_CONFIG: FieldConfig = {
  defaultFields: BASE_FIELDS,
  allowedFields: {
    tenant_owner: FULL_FIELDS,
    tenant_admin: FULL_FIELDS,
    manager: FULL_FIELDS,
    staff: FULL_FIELDS,
    viewer: BASE_FIELDS,
  },
};
