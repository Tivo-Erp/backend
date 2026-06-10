import { FieldConfig } from '../../../common/utils/field-selector.js';

const BASE_FIELDS = [
  'id', 'sku', 'name', 'itemType', 'baseUom',
  'status', 'isPurchasable', 'isSellable', 'createdAt',
];

const FULL_FIELDS = [
  ...BASE_FIELDS,
  'description', 'categoryId', 'weight',
  'isBatchTracked', 'isSerialTracked',
  'minStockLevel', 'safetyStock', 'leadTimeDays',
  'customAttributes', 'updatedAt', 'deletedAt',
];

export const ITEM_FIELD_CONFIG: FieldConfig = {
  defaultFields: BASE_FIELDS,
  allowedFields: {
    admin:        FULL_FIELDS,
    owner:        FULL_FIELDS,
    warehouse_manager: [...BASE_FIELDS, 'isBatchTracked', 'isSerialTracked', 'minStockLevel', 'safetyStock', 'leadTimeDays'],
    sales:        [...BASE_FIELDS, 'description', 'weight'],
    purchasing:   [...BASE_FIELDS, 'description', 'isBatchTracked', 'isSerialTracked', 'minStockLevel', 'safetyStock', 'leadTimeDays'],
    viewer:       BASE_FIELDS,
  },
};
