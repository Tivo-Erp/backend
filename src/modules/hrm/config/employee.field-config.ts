import { FieldConfig } from '../../../common/utils/field-selector.js';

/**
 * Logical (response) field names — note the PII fields (fullName, dateOfBirth,
 * idNumber, taxCode, socialInsNum, bankAccNum) are decrypted on read and only
 * returned in full when the caller holds `hrm:employee:read_pii`; otherwise the
 * service masks them. Field whitelisting here is the role-level coarse gate.
 */
const NON_PII = [
  'id',
  'employeeCode',
  'userId',
  'departmentId',
  'branchId',
  'position',
  'joinDate',
  'status',
  'numberOfDependents',
  'bankName',
  'createdAt',
  'updatedAt',
];

const PII = [
  'fullName',
  'dateOfBirth',
  'idNumber',
  'taxCode',
  'socialInsNum',
  'bankAccNum',
];

const SALARY = ['basicSalary'];

const MANAGER_FIELDS = [...NON_PII, ...PII, ...SALARY];

export const EMPLOYEE_FIELD_CONFIG: FieldConfig = {
  defaultFields: [...NON_PII, 'fullName'],
  allowedFields: {
    tenant_owner: MANAGER_FIELDS,
    tenant_admin: MANAGER_FIELDS,
    manager: MANAGER_FIELDS,
    staff: [...NON_PII, 'fullName'],
    viewer: [...NON_PII, 'fullName'],
  },
};

export const EMPLOYEE_PII_FIELDS = PII;
