import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  jwtPrivateKeyPath: process.env.JWT_PRIVATE_KEY_PATH || './keys/private.pem',
  jwtPublicKeyPath: process.env.JWT_PUBLIC_KEY_PATH || './keys/public.pem',
  jwtAccessTtl: parseInt(process.env.JWT_ACCESS_TTL || '3600', 10),
  jwtRefreshTtl: parseInt(process.env.JWT_REFRESH_TTL || '604800', 10),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
}));
