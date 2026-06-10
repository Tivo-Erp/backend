import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join(__dirname, 'src/infra/database/prisma/schema.prisma'),
  migrations: {
    seed: 'ts-node src/infra/database/prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
