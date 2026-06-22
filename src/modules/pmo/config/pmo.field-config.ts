import { FieldConfig } from '../../../common/utils/field-selector.js';

const PROJECT_BASE = [
  'id',
  'code',
  'name',
  'customerId',
  'managerId',
  'status',
  'priority',
  'startDate',
  'targetEndDate',
  'progressPct',
  'createdAt',
];
const PROJECT_FULL = [
  ...PROJECT_BASE,
  'description',
  'branchId',
  'actualEndDate',
  'budget',
  'currency',
  'createdBy',
  'updatedAt',
];

export const PROJECT_FIELD_CONFIG: FieldConfig = {
  defaultFields: PROJECT_BASE,
  allowedFields: {
    tenant_owner: PROJECT_FULL,
    tenant_admin: PROJECT_FULL,
    manager: PROJECT_FULL,
    staff: PROJECT_BASE,
    viewer: PROJECT_BASE,
  },
};

const TASK_BASE = [
  'id',
  'projectId',
  'parentId',
  'title',
  'assignedTo',
  'status',
  'priority',
  'dueDate',
  'sortOrder',
  'createdAt',
];
const TASK_FULL = [
  ...TASK_BASE,
  'description',
  'startDate',
  'completedAt',
  'estimatedHours',
  'actualHours',
  'updatedAt',
];

export const TASK_FIELD_CONFIG: FieldConfig = {
  defaultFields: TASK_BASE,
  allowedFields: {
    tenant_owner: TASK_FULL,
    tenant_admin: TASK_FULL,
    manager: TASK_FULL,
    staff: TASK_FULL,
    viewer: TASK_BASE,
  },
};

const TS_BASE = [
  'id',
  'employeeId',
  'projectId',
  'taskId',
  'logDate',
  'hours',
  'billable',
  'status',
  'createdAt',
];
const TS_FULL = [
  ...TS_BASE,
  'description',
  'approvedBy',
  'approvedAt',
  'updatedAt',
];

export const TIMESHEET_FIELD_CONFIG: FieldConfig = {
  defaultFields: TS_BASE,
  allowedFields: {
    tenant_owner: TS_FULL,
    tenant_admin: TS_FULL,
    manager: TS_FULL,
    staff: TS_FULL,
    viewer: TS_BASE,
  },
};
