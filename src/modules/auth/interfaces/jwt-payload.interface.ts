export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  tenantSlug: string;
  roles: string[];
  permissions: string[];
  isSuperAdmin: boolean;
  iat: number;
  exp: number;
}
