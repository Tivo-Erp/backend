import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

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

  const isProduction = process.env.NODE_ENV === 'production';

  // ─── Swagger / OpenAPI (disabled in production unless explicitly enabled) ───
  if (!isProduction || process.env.SWAGGER_ENABLED === 'true') {
    const swaggerConfig = new DocumentBuilder()
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
      )
      .addServer(
        `http://localhost:${process.env.PORT || 3000}`,
        'Local Development',
      )
      .build();

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
  // (comma-separated); otherwise cross-origin requests are refused.
  app.enableCors({
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
      : !isProduction,
    credentials: true,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`ERP Backend running on port ${port}`);
  console.log(`Swagger docs: http://localhost:${port}/api/docs`);
}
bootstrap();
