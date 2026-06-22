import { FieldConfig } from '../../../common/utils/field-selector.js';

const BASE_FIELDS = [
  'itemId',
  'itemSku',
  'itemName',
  'warehouseId',
  'warehouseCode',
  'quantityOnHand',
  'quantityReserved',
  'quantityAvailable',
  'uom',
  'isBelowRop',
];

const FULL_FIELDS = [
  ...BASE_FIELDS,
  'binLabel',
  'lotNumber',
  'costPerUnit',
  'totalValue',
  'minStockLevel',
];

export const BALANCE_FIELD_CONFIG: FieldConfig = {
  defaultFields: BASE_FIELDS,
  allowedFields: {
    admin: FULL_FIELDS,
    owner: FULL_FIELDS,
    warehouse_manager: FULL_FIELDS,
    purchasing: [...BASE_FIELDS, 'minStockLevel', 'costPerUnit', 'totalValue'],
    viewer: BASE_FIELDS,
  },
};
