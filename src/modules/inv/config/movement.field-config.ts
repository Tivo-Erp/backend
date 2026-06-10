import { FieldConfig } from 'src/common/utils/field-selector.js';

const BASE_FIELDS = [
  'id', 'movementType', 'direction',
  'quantity', 'uom',
  'createdAt',
];

const FULL_FIELDS = [
  ...BASE_FIELDS,
  'costPerUnit',
  'referenceType', 'referenceId',
  'notes', 'createdBy',
];

export const MOVEMENT_FIELD_CONFIG: FieldConfig = {
  defaultFields: BASE_FIELDS,
  allowedFields: {
    admin:             FULL_FIELDS,
    owner:             FULL_FIELDS,
    warehouse_manager: FULL_FIELDS,
    viewer:            BASE_FIELDS,
  },
};
