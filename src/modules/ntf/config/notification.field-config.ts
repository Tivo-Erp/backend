import { FieldConfig } from '../../../common/utils/field-selector.js';

const BASE_FIELDS = [
  'id',
  'title',
  'category',
  'entityType',
  'entityId',
  'actionUrl',
  'isRead',
  'readAt',
  'createdAt',
];

const FULL_FIELDS = [...BASE_FIELDS, 'body', 'userId'];

export const NOTIFICATION_FIELD_CONFIG: FieldConfig = {
  defaultFields: BASE_FIELDS,
  allowedFields: {
    tenant_owner: FULL_FIELDS,
    tenant_admin: FULL_FIELDS,
    manager: FULL_FIELDS,
    staff: FULL_FIELDS,
    viewer: FULL_FIELDS,
  },
};
