/** BullMQ queue + job catalog (INF-001 / ADR-004). */

// BullMQ v5 forbids ':' in queue names (it is the Redis key separator), so the
// segments use '-'. BullMQ still namespaces its own keys with ':' internally.
export const QUEUE_CRON = 'erp-cron';
export const QUEUE_EMAIL = 'erp-email';
export const QUEUE_OUTBOX = 'erp-outbox';

export const ALL_QUEUES = [QUEUE_CRON, QUEUE_EMAIL, QUEUE_OUTBOX] as const;

export const JOB = {
  /** Monthly straight-line/declining-balance depreciation posting (all tenants). */
  DEPRECIATION_RUN: 'depreciation.run',
  /** Auto-close support tickets resolved > 7 days ago. */
  TICKET_AUTOCLOSE: 'ticket.autoclose',
  /** Notify owners of tickets whose SLA has breached. */
  SLA_ESCALATION: 'ticket.sla-escalation',
  /** Send one transactional email (payload = EmailJobData). */
  EMAIL_SEND: 'email.send',
  /** Drain pending transactional-outbox rows to the broker. */
  OUTBOX_DISPATCH: 'outbox.dispatch',
  /** BI-001: reload the DuckDB OLAP facts from OLTP for every active tenant. */
  BI_ETL_SYNC: 'bi.etl.sync',
} as const;

/** Cron schedules (UTC). Registered as BullMQ repeatable jobs on the API instance. */
export const CRON_SCHEDULES: Array<{ name: string; pattern: string }> = [
  // 02:00 on the 1st of every month — depreciation for the previous month.
  { name: JOB.DEPRECIATION_RUN, pattern: '0 2 1 * *' },
  // Hourly — close stale resolved tickets.
  { name: JOB.TICKET_AUTOCLOSE, pattern: '0 * * * *' },
  // Every 15 minutes — SLA breach escalation.
  { name: JOB.SLA_ESCALATION, pattern: '*/15 * * * *' },
  // Every minute — drain the transactional outbox to RabbitMQ.
  { name: JOB.OUTBOX_DISPATCH, pattern: '* * * * *' },
  // Every 15 minutes — reload the OLAP cubes (no-op when DuckDB is unconfigured).
  { name: JOB.BI_ETL_SYNC, pattern: '*/15 * * * *' },
];
