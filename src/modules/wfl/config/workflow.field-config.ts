import { FieldConfig } from '../../../common/utils/field-selector.js';

const DEF_BASE = [
  'id',
  'name',
  'triggerEntity',
  'triggerEvent',
  'isActive',
  'createdAt',
];
const DEF_FULL = [...DEF_BASE, 'triggerCondition', 'updatedAt'];

export const WORKFLOW_DEFINITION_FIELD_CONFIG: FieldConfig = {
  defaultFields: DEF_BASE,
  allowedFields: {
    tenant_owner: DEF_FULL,
    tenant_admin: DEF_FULL,
    manager: DEF_FULL,
    staff: DEF_BASE,
    viewer: DEF_BASE,
  },
};

const INST_BASE = [
  'id',
  'definitionId',
  'entityType',
  'entityId',
  'currentStep',
  'status',
  'requestedBy',
  'createdAt',
];
const INST_FULL = [...INST_BASE, 'updatedAt'];

export const WORKFLOW_INSTANCE_FIELD_CONFIG: FieldConfig = {
  defaultFields: INST_BASE,
  allowedFields: {
    tenant_owner: INST_FULL,
    tenant_admin: INST_FULL,
    manager: INST_FULL,
    staff: INST_BASE,
    viewer: INST_BASE,
  },
};
