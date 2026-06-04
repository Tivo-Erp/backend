import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // ─── Swagger / OpenAPI ───────────────────────────
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
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'RS256 JWT Access Token' },
      'JWT-Auth',
    )
    .addServer(`http://localhost:${process.env.PORT || 3000}`, 'Local Development')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`ERP Backend running on port ${port}`);
  console.log(`Swagger docs: http://localhost:${port}/api/docs`);
}
bootstrap();
