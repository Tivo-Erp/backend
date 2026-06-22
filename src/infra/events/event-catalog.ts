/**
 * Domain event catalog (INF-002 / ADR-005-006). Event types are dot-namespaced
 * `<module>.<aggregate>.<action>` and double as the RabbitMQ routing key.
 *
 * Producers write an {@link OutboxEvent} with one of these types inside the
 * same `$transaction` as the business mutation (dual-write safety); the outbox
 * dispatcher then publishes them to the `erp.events` topic exchange.
 */
export const EVENT = {
  // Delivery / Sales
  DN_DELIVERED: 'sales.dn.delivered',
  DELIVERY_RETURNED: 'delivery.returned',
  SO_CONFIRMED: 'sales.so.confirmed',
  // Shipping (M-SHP)
  SHIPMENT_TRACKING_UPDATED: 'shipping.shipment.tracking_updated',
  // Procurement
  GRN_RECEIVED: 'purchase.grn.received',
  // Finance
  PAYMENT_POSTED: 'finance.payment.posted',
  INVOICE_ISSUED: 'finance.invoice.issued',
  // HRM
  PAYROLL_APPROVED: 'hrm.payroll.approved',
  LEAVE_APPROVED: 'hrm.leave.approved',
  // Workflow
  WORKFLOW_STEP_ASSIGNED: 'workflow.step.assigned',
} as const;

export type EventType = (typeof EVENT)[keyof typeof EVENT];
