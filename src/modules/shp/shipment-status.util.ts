/**
 * Shipment lifecycle (SRS_03b §2.1):
 *   created → label_printed → picked_up → in_transit → out_for_delivery → delivered
 *   +failed → (in_transit | returned)
 *
 * Tracking updates may only move a shipment FORWARD (or into failed/returned);
 * an out-of-order carrier webhook must never regress the status.
 */

export const SHIPMENT_STATUSES = [
  'created',
  'label_printed',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'failed',
  'returned',
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** Monotonic rank for the happy-path statuses. */
const RANK: Record<string, number> = {
  created: 0,
  label_printed: 1,
  picked_up: 2,
  in_transit: 3,
  out_for_delivery: 4,
  delivered: 5,
};

const TERMINAL = new Set(['delivered', 'returned']);

/** Whether `next` is a legal transition from `current` (ignoring no-op repeats). */
export function canTransition(current: string, next: string): boolean {
  if (current === next) return false;
  if (TERMINAL.has(current)) return false; // delivered/returned are final
  if (next === 'failed') return true; // can fail from any non-terminal state
  if (next === 'returned') return current === 'failed';
  if (current === 'failed') return next === 'in_transit' || next === 'returned';
  // Happy path: forward-only by rank.
  const c = RANK[current];
  const n = RANK[next];
  if (c === undefined || n === undefined) return false;
  return n > c;
}

/** Normalize a raw carrier-supplied status string to our internal vocabulary. */
export function normalizeCarrierStatus(raw: string): ShipmentStatus | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const map: Record<string, ShipmentStatus> = {
    created: 'created',
    ready_to_pick: 'created',
    label_printed: 'label_printed',
    label_created: 'label_printed',
    picked_up: 'picked_up',
    picking: 'picked_up',
    picked: 'picked_up',
    in_transit: 'in_transit',
    transporting: 'in_transit',
    storing: 'in_transit',
    out_for_delivery: 'out_for_delivery',
    delivering: 'out_for_delivery',
    delivered: 'delivered',
    delivery_success: 'delivered',
    success: 'delivered',
    failed: 'failed',
    delivery_fail: 'failed',
    delivery_failed: 'failed',
    cancel: 'failed',
    returned: 'returned',
    returning: 'returned',
    return: 'returned',
  };
  return map[s] ?? null;
}
