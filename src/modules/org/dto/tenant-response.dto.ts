export class TenantResponseDto {
  tenantId: string;
  userId: string;
  slug: string;
  status: string;
  message: string;
}

export class TenantProfileResponseDto {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  taxCode: string | null;
  logoUrl: string | null;
  timezone: string;
  locale: string;
  baseCurrency: string;
  status: string;
  settings: any;
  subscription: {
    planCode: string;
    planName: string;
    status: string;
    trialEndDate: Date | null;
    currentPeriodEnd: Date | null;
    maxUsers: number | null;
  } | null;
}
