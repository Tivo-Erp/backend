import { FieldConfig } from '../../../common/utils/field-selector.js';

// ── Carrier ────────────────────────────────────────────────────
// NOTE: apiKeyEncrypted and webhookSecret are NEVER exposed through any field
// set — they are secrets and have no place in a read response.

const CARRIER_BASE = ['id', 'code', 'name', 'isActive', 'createdAt'];
const CARRIER_FULL = [...CARRIER_BASE, 'apiEndpoint', 'config', 'updatedAt'];

export const CARRIER_FIELD_CONFIG: FieldConfig = {
  defaultFields: CARRIER_BASE,
  allowedFields: {
    tenant_owner: CARRIER_FULL,
    tenant_admin: CARRIER_FULL,
    manager: CARRIER_FULL,
    staff: CARRIER_BASE,
    viewer: CARRIER_BASE,
  },
};

// ── Shipment ───────────────────────────────────────────────────

const SHIPMENT_BASE = [
  'id',
  'shipmentNumber',
  'dnId',
  'carrierId',
  'trackingNumber',
  'status',
  'serviceType',
  'estimatedDelivery',
  'actualDelivery',
  'createdAt',
];
const SHIPMENT_FULL = [
  ...SHIPMENT_BASE,
  'weightKg',
  'lengthCm',
  'widthCm',
  'heightCm',
  'isCod',
  'codAmount',
  'shippingCost',
  'shippingLabelKey',
  'failureReason',
  'createdBy',
  'updatedAt',
];

export const SHIPMENT_FIELD_CONFIG: FieldConfig = {
  defaultFields: SHIPMENT_BASE,
  allowedFields: {
    tenant_owner: SHIPMENT_FULL,
    tenant_admin: SHIPMENT_FULL,
    manager: SHIPMENT_FULL,
    staff: SHIPMENT_FULL,
    viewer: SHIPMENT_BASE,
  },
};
