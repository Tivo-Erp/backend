import { Injectable } from '@nestjs/common';
import {
  Registry,
  collectDefaultMetrics,
  Histogram,
  Counter,
} from 'prom-client';

/**
 * INF-006 — Prometheus metrics registry (ADR-017). Owns a private registry so
 * default Node/process metrics plus HTTP and business counters are exposed at
 * `GET /metrics`. Use {@link recordHttp} from the metrics interceptor and
 * {@link businessCounter} for domain events.
 */
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly httpDuration: Histogram<string>;
  private readonly httpTotal: Counter<string>;
  private readonly business: Counter<string>;

  constructor() {
    this.registry.setDefaultLabels({ app: 'erp-backend' });
    collectDefaultMetrics({ register: this.registry });

    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
      registers: [this.registry],
    });
    this.httpTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });
    this.business = new Counter({
      name: 'erp_business_events_total',
      help: 'Business-level event counter',
      labelNames: ['event'],
      registers: [this.registry],
    });
  }

  recordHttp(
    method: string,
    route: string,
    status: number,
    durationSec: number,
  ): void {
    const labels = { method, route, status: String(status) };
    this.httpDuration.observe(labels, durationSec);
    this.httpTotal.inc(labels);
  }

  businessCounter(event: string, value = 1): void {
    this.business.inc({ event }, value);
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }
}
