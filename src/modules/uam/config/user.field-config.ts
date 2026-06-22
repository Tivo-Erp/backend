import { FieldConfig } from '../../../common/utils/field-selector.js';

export const USER_FIELD_CONFIG: FieldConfig = {
  defaultFields: ['id', 'email', 'firstName', 'lastName', 'status'],
  allowedFields: {
    tenant_owner: [
      'id',
      'email',
      'firstName',
      'lastName',
      'status',
      'lastLoginAt',
      'lastLoginIp',
      'createdAt',
      'updatedAt',
      'roles.id',
      'roles.name',
    ],
    tenant_admin: [
      'id',
      'email',
      'firstName',
      'lastName',
      'status',
      'lastLoginAt',
      'createdAt',
      'roles.id',
      'roles.name',
    ],
    manager: [
      'id',
      'email',
      'firstName',
      'lastName',
      'status',
      'roles.id',
      'roles.name',
    ],
    staff: ['id', 'email', 'firstName', 'lastName', 'status'],
    viewer: ['id', 'firstName', 'lastName', 'status'],
  },
};
