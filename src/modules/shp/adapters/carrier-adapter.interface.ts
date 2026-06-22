/**
 * Carrier integration adapter (SHP-002). A thin contract over a shipping
 * provider's HTTP API so the shipment service stays carrier-agnostic. Real
 * providers (GHN/GHTK/DHL) implement this incrementally; {@link MockCarrierAdapter}
 * backs the default flow + tests when no external API is wired.
 */

export interface CarrierContext {
  /** Decrypted API key (from Carrier.apiKeyEncrypted), if configured. */
  apiKey?: string | null;
  apiEndpoint?: string | null;
  /** Free-form carrier config (defaultServiceType, supportedRegions…). */
  config?: Record<string, unknown> | null;
}

export interface RateRequest {
  weightKg: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  serviceType?: string;
  isCod?: boolean;
  codAmount?: number;
  toRegion?: string;
}

export interface RateQuote {
  carrierCode: string;
  serviceType: string;
  amount: number;
  currency: string;
  estimatedDays?: number;
}

export interface LabelRequest {
  shipmentNumber: string;
  serviceType?: string;
  weightKg?: number;
  isCod?: boolean;
  codAmount?: number;
  toRegion?: string;
}

export interface LabelResult {
  trackingNumber: string;
  /** Raw label bytes (PDF/PNG) to persist in MinIO, if the carrier returns one. */
  labelContent?: Buffer;
  labelContentType?: string;
  estimatedDelivery?: Date;
  shippingCost?: number;
}

export interface TrackResult {
  status: string;
  description?: string;
  location?: string;
  eventTime: Date;
}

export interface CarrierAdapter {
  readonly code: string;
  /** Whether this adapter can reach a live API (false ⇒ manual tracking entry). */
  isLive(ctx: CarrierContext): boolean;
  getRate(ctx: CarrierContext, req: RateRequest): Promise<RateQuote>;
  getLabel(ctx: CarrierContext, req: LabelRequest): Promise<LabelResult>;
  track(ctx: CarrierContext, trackingNumber: string): Promise<TrackResult[]>;
}
