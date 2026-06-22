-- ============================================================
-- Outbox dispatcher hardening + SLA escalation watermark
-- ============================================================

-- INF-002: dispatcher claim timestamp. Rows are claimed pending → 'processing'
-- (FOR UPDATE SKIP LOCKED); claimedAt lets a later run reclaim rows orphaned
-- by a crashed dispatcher.
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3);

-- Helpdesk SLA escalation watermark: replaces the lossy 20-minute time-window
-- scan (double-notified overlapping windows, missed breaches during downtime).
-- NULL = not yet escalated; set exactly once when the breach notification fires.
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "slaEscalatedAt" TIMESTAMP(3);
