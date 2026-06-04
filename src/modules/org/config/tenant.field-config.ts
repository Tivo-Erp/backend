import { FieldConfig } from '../../../common/utils/field-selector.js';

export const TENANT_FIELD_CONFIG: FieldConfig = {
  defaultFields: ['id', 'slug', 'name', 'status', 'timezone'],
  allowedFields: {
    tenant_owner: [
      'id', 'slug', 'name', 'legalName', 'taxCode', 'logoUrl',
      'timezone', 'locale', 'baseCurrency', 'status', 'settings',
      'subscription.planCode', 'subscription.planName', 'subscription.status',
      'subscription.trialEndDate', 'subscription.currentPeriodEnd', 'subscription.maxUsers',
    ],
    tenant_admin: [
      'id', 'slug', 'name', 'legalName', 'taxCode', 'logoUrl',
      'timezone', 'locale', 'baseCurrency', 'status',
    ],
    manager: ['id', 'slug', 'name', 'timezone', 'locale', 'baseCurrency', 'status'],
    staff: ['id', 'slug', 'name', 'timezone', 'locale', 'status'],
    viewer: ['id', 'slug', 'name', 'status'],
  },
};
