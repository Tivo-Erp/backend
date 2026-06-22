import { FieldConfig } from '../../../common/utils/field-selector.js';

export const AUDIT_LOG_FIELD_CONFIG: FieldConfig = {
  defaultFields: ['id', 'module', 'action', 'userId', 'createdAt'],
  allowedFields: {
    tenant_owner: [
      'id',
      'module',
      'action',
      'userId',
      'targetEntity',
      'targetId',
      'changes',
      'ipAddress',
      'userAgent',
      'createdAt',
    ],
    tenant_admin: [
      'id',
      'module',
      'action',
      'userId',
      'targetEntity',
      'targetId',
      'changes',
      'ipAddress',
      'createdAt',
    ],
  },
};
