import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { SellerAuthController } from './seller-auth.controller';
import { SellerAuthService } from './seller-auth.service';
import { SellerJwtStrategy } from './seller-jwt.strategy';
import { SellerRiskControlModule } from '../risk-control/seller-risk-control.module';

@Module({
  imports: [
    PassportModule,
    SellerRiskControlModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('SELLER_JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('SELLER_JWT_EXPIRES_IN', '8h') as any,
        },
      }),
    }),
  ],
  controllers: [SellerAuthController],
  providers: [SellerAuthService, SellerJwtStrategy],
  exports: [SellerAuthService],
})
export class SellerAuthModule {}
