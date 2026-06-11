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
  'updatedAt',
];

/** Credit fields are restricted to privileged roles only. */
const PRIVILEGED_FIELDS = [...FULL_FIELDS, 'creditLimit', 'creditUsed'];

export const SUPPLIER_FIELD_CONFIG: FieldConfig = {
  defaultFields: BASE_FIELDS,
  allowedFields: {
    tenant_owner: PRIVILEGED_FIELDS,
    tenant_admin: PRIVILEGED_FIELDS,
    manager: PRIVILEGED_FIELDS,
    staff: FULL_FIELDS,
    viewer: BASE_FIELDS,
  },
};
