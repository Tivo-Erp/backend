import { FieldConfig } from '../../../common/utils/field-selector.js';

export const ROLE_FIELD_CONFIG: FieldConfig = {
  defaultFields: ['id', 'name', 'description', 'isSystem'],
  allowedFields: {
    tenant_owner: [
      'id', 'name', 'description', 'isSystem', 'createdAt', 'updatedAt',
      'permissions.id', 'permissions.code', 'permissions.module', 'permissions.description',
    ],
    tenant_admin: [
      'id', 'name', 'description', 'isSystem', 'createdAt',
      'permissions.id', 'permissions.code', 'permissions.module',
    ],
    manager: ['id', 'name', 'description', 'isSystem'],
    staff: ['id', 'name', 'description'],
    viewer: ['id', 'name'],
  },
};
