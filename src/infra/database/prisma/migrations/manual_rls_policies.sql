-- RLS Policies for Tenant Isolation
-- Run AFTER prisma migrate dev

-- Enable RLS on tenant-scoped tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policies
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation ON branches
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation ON roles
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation ON audit_logs
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation ON document_sequences
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation ON subscriptions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- user_roles and role_permissions are joined tables - isolate via role's tenant
CREATE POLICY tenant_isolation ON user_roles
  USING (role_id IN (SELECT id FROM roles WHERE tenant_id = current_setting('app.current_tenant_id')::uuid));

CREATE POLICY tenant_isolation ON role_permissions
  USING (role_id IN (SELECT id FROM roles WHERE tenant_id = current_setting('app.current_tenant_id')::uuid));
