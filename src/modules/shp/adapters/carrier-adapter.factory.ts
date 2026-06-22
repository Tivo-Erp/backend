import { Injectable } from '@nestjs/common';
import { CarrierAdapter } from './carrier-adapter.interface.js';
import { MockCarrierAdapter } from './mock-carrier.adapter.js';

/**
 * Resolves a {@link CarrierAdapter} for a carrier code. Real provider adapters
 * (GHN/GHTK/DHL) register here as they are implemented; until then every code
 * falls back to a {@link MockCarrierAdapter} stamped with that code, so the
 * shipment flow works end-to-end without an external integration.
 */
@Injectable()
export class CarrierAdapterFactory {
  private readonly live = new Map<string, CarrierAdapter>();

  /** Register a live adapter for a carrier code (called by future provider modules). */
  register(adapter: CarrierAdapter): void {
    this.live.set(adapter.code.toUpperCase(), adapter);
  }

  forCode(code: string): CarrierAdapter {
    return (
      this.live.get(code.toUpperCase()) ??
      new MockCarrierAdapter(code.toUpperCase())
    );
  }
}
