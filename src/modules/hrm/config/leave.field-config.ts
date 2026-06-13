import { FieldConfig } from '../../../common/utils/field-selector.js';

const BASE = [
  'id',
  'employeeId',
  'leaveTypeId',
  'startDate',
  'endDate',
  'totalDays',
  'halfDay',
  'status',
  'createdAt',
];
const FULL = [...BASE, 'reason', 'approvedBy', 'approvedAt'];

export const LEAVE_REQUEST_FIELD_CONFIG: FieldConfig = {
  defaultFields: BASE,
  allowedFields: {
    tenant_owner: FULL,
    tenant_admin: FULL,
    manager: FULL,
    staff: FULL,
    viewer: BASE,
  },
};
