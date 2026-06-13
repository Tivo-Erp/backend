import { FieldConfig } from '../../../common/utils/field-selector.js';

const BASE = [
  'id',
  'dnNumber',
  'soId',
  'customerId',
  'warehouseId',
  'status',
  'shipDate',
  'deliveryMethod',
  'deliveredAt',
  'createdAt',
];

const FULL = [
  ...BASE,
  'shippingAddress',
  'contactPerson',
  'contactPhone',
  'deliveryInstructions',
  'driverName',
  'driverPhone',
  'vehiclePlate',
  'carrierId',
  'serviceType',
  'packedWeightKg',
  'totalPackages',
  'packingNotes',
  'failureReason',
  'retryCount',
  'returnReason',
  'returnWarehouseId',
  'podType',
  'receiverName',
  'podNotes',
  'notes',
  'createdBy',
  'updatedAt',
];

export const DELIVERY_NOTE_FIELD_CONFIG: FieldConfig = {
  defaultFields: BASE,
  allowedFields: {
    tenant_owner: FULL,
    tenant_admin: FULL,
    manager: FULL,
    staff: FULL,
    viewer: BASE,
  },
};
