-- Batch 4 review fixes
-- Work orders move from hard delete to the project-wide soft-delete convention.
ALTER TABLE "work_orders" ADD COLUMN "deletedAt" TIMESTAMP(3);
