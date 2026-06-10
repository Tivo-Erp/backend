import { FieldConfig } from '../../../common/utils/field-selector.js';

const BASE_FIELDS = ['id', 'code', 'name', 'branchId', 'isActive', 'createdAt'];
const FULL_FIELDS = [...BASE_FIELDS, 'address', 'updatedAt'];

export const WAREHOUSE_FIELD_CONFIG: FieldConfig = {
  defaultFields: BASE_FIELDS,
  allowedFields: {
    admin:             FULL_FIELDS,
    owner:             FULL_FIELDS,
    warehouse_manager: FULL_FIELDS,
    viewer:            BASE_FIELDS,
  },
};

const ZONE_BASE = ['id', 'code', 'name', 'zoneType'];

export const ZONE_FIELD_CONFIG: FieldConfig = {
  defaultFields: ZONE_BASE,
  allowedFields: {
    admin:             ZONE_BASE,
    owner:             ZONE_BASE,
    warehouse_manager: ZONE_BASE,
    viewer:            ZONE_BASE,
  },
};

const BIN_BASE = ['id', 'barcode', 'label', 'binType', 'isActive'];
const BIN_FULL = [...BIN_BASE, 'maxWeightKg'];

export const BIN_FIELD_CONFIG: FieldConfig = {
  defaultFields: BIN_BASE,
  allowedFields: {
    admin:             BIN_FULL,
    owner:             BIN_FULL,
    warehouse_manager: BIN_FULL,
    viewer:            BIN_BASE,
  },
};
