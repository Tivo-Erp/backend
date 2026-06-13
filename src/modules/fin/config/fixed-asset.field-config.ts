import { FieldConfig } from '../../../common/utils/field-selector.js';

const BASE = [
  'id',
  'assetCode',
  'name',
  'accountCode',
  'acquisitionCost',
  'residualValue',
  'acquisitionDate',
  'depreciationMethod',
  'usefulLifeMonths',
  'status',
  'accumulatedDepreciation',
  'createdAt',
];

const FULL = [
  ...BASE,
  'inServiceDate',
  'expenseAccountCode',
  'departmentId',
  'branchId',
  'disposalDate',
  'disposalProceeds',
  'notes',
  'createdBy',
  'updatedAt',
];

export const FIXED_ASSET_FIELD_CONFIG: FieldConfig = {
  defaultFields: BASE,
  allowedFields: {
    tenant_owner: FULL,
    tenant_admin: FULL,
    manager: FULL,
    staff: BASE,
    viewer: BASE,
  },
};
