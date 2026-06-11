import { FieldConfig } from '../../../common/utils/field-selector.js';

const BASE_FIELDS = [
  'id',
  'code',
  'name',
  'taxCode',
  'email',
  'phone',
  'paymentTermsDays',
  'isActive',
  'createdAt',
];

const FULL_FIELDS = [
  ...BASE_FIELDS,
  'legalName',
  'contactName',
  'address',
  'creditLimit',
  'creditUsed',
  'updatedAt',
];

export const CUSTOMER_FIELD_CONFIG: FieldConfig = {
  defaultFields: BASE_FIELDS,
  allowedFields: {
    admin: FULL_FIELDS,
    owner: FULL_FIELDS,
    sales: FULL_FIELDS,
    sales_manager: FULL_FIELDS,
    viewer: BASE_FIELDS,
  },
};
