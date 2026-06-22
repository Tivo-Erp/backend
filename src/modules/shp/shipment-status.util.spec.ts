import {
  canTransition,
  normalizeCarrierStatus,
} from './shipment-status.util.js';

describe('shipment-status util', () => {
  describe('canTransition', () => {
    it('allows forward moves along the happy path', () => {
      expect(canTransition('created', 'label_printed')).toBe(true);
      expect(canTransition('label_printed', 'picked_up')).toBe(true);
      expect(canTransition('in_transit', 'out_for_delivery')).toBe(true);
      expect(canTransition('out_for_delivery', 'delivered')).toBe(true);
      // skipping intermediate statuses is still forward → allowed
      expect(canTransition('created', 'in_transit')).toBe(true);
    });

    it('rejects regressive (out-of-order webhook) moves', () => {
      expect(canTransition('in_transit', 'picked_up')).toBe(false);
      expect(canTransition('delivered', 'in_transit')).toBe(false);
      expect(canTransition('out_for_delivery', 'created')).toBe(false);
    });

    it('treats delivered/returned as terminal', () => {
      expect(canTransition('delivered', 'failed')).toBe(false);
      expect(canTransition('returned', 'in_transit')).toBe(false);
    });

    it('allows failing from any non-terminal state and returning only from failed', () => {
      expect(canTransition('in_transit', 'failed')).toBe(true);
      expect(canTransition('out_for_delivery', 'failed')).toBe(true);
      expect(canTransition('failed', 'returned')).toBe(true);
      expect(canTransition('failed', 'in_transit')).toBe(true);
      expect(canTransition('in_transit', 'returned')).toBe(false);
    });

    it('rejects no-op repeats', () => {
      expect(canTransition('in_transit', 'in_transit')).toBe(false);
    });
  });

  describe('normalizeCarrierStatus', () => {
    it('maps known carrier vocabularies to internal statuses', () => {
      expect(normalizeCarrierStatus('Delivery Success')).toBe('delivered');
      expect(normalizeCarrierStatus('transporting')).toBe('in_transit');
      expect(normalizeCarrierStatus('PICKED')).toBe('picked_up');
      expect(normalizeCarrierStatus('delivery_fail')).toBe('failed');
      expect(normalizeCarrierStatus('returning')).toBe('returned');
    });

    it('returns null for unmapped statuses', () => {
      expect(normalizeCarrierStatus('teleported')).toBeNull();
    });
  });
});
