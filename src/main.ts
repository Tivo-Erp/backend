import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Logger } from 'nestjs-pino';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { initSentry } from './infra/observability/sentry.js';

async function bootstrap() {
  // INF-006: initialise error tracking before the app boots (no-op without DSN).
  initSentry();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true },
  );

  // INF-006: route Nest logs through pino (structured JSON + correlationId).
  app.useLogger(app.get(Logger));

  // CSP disabled because Swagger UI requires inline scripts; all other
  // helmet protections (HSTS, nosniff, frameguard, ...) stay on.
  await app.register(helmet, { contentSecurityPolicy: false });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // Socket.IO for realtime notifications (NTF-001 / ADR-014). The IoAdapter is
  // required under the Fastify adapter; the gateway attaches a Redis adapter at
  // runtime when REDIS_URL is set (see NotificationGateway.afterInit).
  app.useWebSocketAdapter(new IoAdapter(app));

  const isProduction = process.env.NODE_ENV === 'production';

  // ─── Swagger / OpenAPI (disabled in production unless explicitly enabled) ───
  if (!isProduction || process.env.SWAGGER_ENABLED === 'true') {
    const builder = new DocumentBuilder()
      .setTitle('ERP Backend API')
      .setDescription(
        'ERP Modular Monolith — Multi-tenant REST API.\n\n' +
          '**Auth:** Bearer JWT (RS256).  \n' +
          '**Sparse Fieldsets:** Append `?fields=id,name,...` to GET endpoints.  \n' +
          '**Pagination:** `?page=1&limit=20&sortBy=createdAt&sortOrder=desc`',
      )
      .setVersion('0.1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'RS256 JWT Access Token',
        },
        'JWT-Auth',
      );

    // Server list for the "Try it out" feature. The FIRST entry is the default
    // Swagger UI targets, so order matters. Behind a WAF / reverse proxy the docs
    // are served at a public HTTPS domain and the browser must hit that same
    // origin — never localhost (mixed-content + CORS from an HTTPS page).
    //   1. The explicit public URL (SWAGGER_SERVER_URL) — default when set.
    //   2. A relative "/" that auto-follows whatever origin serves the docs.
    //   3. localhost, ONLY in non-production (omitted in prod so the docs can
    //      never default to an unreachable http://localhost).
    if (process.env.SWAGGER_SERVER_URL) {
      builder.addServer(process.env.SWAGGER_SERVER_URL, 'Public API');
    }
    builder.addServer('/', 'Current host (auto / behind proxy)');
    if (!isProduction) {
      builder.addServer(
        `http://localhost:${process.env.PORT || 3000}`,
        'Local Development',
      );
    }

    const swaggerConfig = builder.build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
  }

  // In production, allowed origins must be listed explicitly via CORS_ORIGINS
  // (comma-separated); otherwise cross-origin requests are refused. Accept ';'
  // as a separator too — a common mistake — and drop empty entries.
  app.enableCors({
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(/[,;]/)
          .map((o) => o.trim())
          .filter(Boolean)
      : !isProduction,
    credentials: true,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`ERP Backend running on port ${port}`);
  console.log(`Swagger docs: http://localhost:${port}/api/docs`);
}
bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap', err);
  process.exit(1);
});
