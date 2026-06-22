import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import { AuthController } from './controllers/auth.controller.js';
import { AuthService } from './services/auth.service.js';
import { AuthTokenService } from './services/auth-token.service.js';
import { AccountSecurityService } from './services/account-security.service.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const privateKeyPath = config.get<string>(
          'app.jwtPrivateKeyPath',
          './keys/private.pem',
        );
        const accessTtl = config.get<number>('app.jwtAccessTtl', 3600);
        return {
          privateKey: fs.readFileSync(privateKeyPath),
          signOptions: {
            algorithm: 'RS256',
            expiresIn: `${accessTtl}s`,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthTokenService,
    AccountSecurityService,
    JwtStrategy,
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
