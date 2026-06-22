import {
  CarrierAdapter,
  CarrierContext,
  LabelRequest,
  LabelResult,
  RateRequest,
  RateQuote,
  TrackResult,
} from './carrier-adapter.interface.js';

/**
 * Deterministic stand-in for a real carrier integration. It never calls out to
 * the network, so it is safe in dev/test and as the default until a live
 * GHN/GHTK/DHL adapter is enabled. Rates are a simple weight × base-rate model;
 * a label "tracking number" is derived from the shipment number so the flow is
 * reproducible.
 */
export class MockCarrierAdapter implements CarrierAdapter {
  constructor(public readonly code: string = 'MOCK') {}

  /** The mock is always "live" so create-with-label works without an API key. */
  isLive(): boolean {
    return true;
  }

  getRate(_ctx: CarrierContext, req: RateRequest): Promise<RateQuote> {
    const base = 25_000; // VND base fee
    const perKg = 8_000;
    const expressMultiplier = req.serviceType === 'express' ? 1.6 : 1;
    const amount = Math.round(
      (base + perKg * Math.max(req.weightKg, 0.5)) * expressMultiplier,
    );
    return Promise.resolve({
      carrierCode: this.code,
      serviceType: req.serviceType ?? 'standard',
      amount,
      currency: 'VND',
      estimatedDays: req.serviceType === 'express' ? 1 : 3,
    });
  }

  async getLabel(
    _ctx: CarrierContext,
    req: LabelRequest,
  ): Promise<LabelResult> {
    const trackingNumber = `${this.code}-${req.shipmentNumber}`;
    const rate = await this.getRate(_ctx, {
      weightKg: req.weightKg ?? 1,
      serviceType: req.serviceType,
      isCod: req.isCod,
      codAmount: req.codAmount,
      toRegion: req.toRegion,
    });
    const eta = new Date(
      Date.now() + (rate.estimatedDays ?? 3) * 24 * 60 * 60 * 1000,
    );
    const label = Buffer.from(
      `MOCK SHIPPING LABEL\nShipment: ${req.shipmentNumber}\nTracking: ${trackingNumber}\nService: ${rate.serviceType}\n`,
      'utf8',
    );
    return {
      trackingNumber,
      labelContent: label,
      labelContentType: 'text/plain',
      estimatedDelivery: eta,
      shippingCost: rate.amount,
    };
  }

  track(_ctx: CarrierContext, trackingNumber: string): Promise<TrackResult[]> {
    const events: TrackResult[] = [
      {
        status: 'created',
        description: `Shipment registered with ${this.code}`,
        location: 'Origin hub',
        eventTime: new Date(),
      },
    ];
    return Promise.resolve(
      events.map((e) => ({
        ...e,
        description: `${e.description} (${trackingNumber})`,
      })),
    );
  }
}
