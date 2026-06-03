import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { OtpCleanupService } from './otp-cleanup.service';
import { CouponModule } from '../coupon/coupon.module';
import { CaptchaModule } from '../captcha/captcha.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '15m') as any },
      }),
    }),
    CouponModule,
    CaptchaModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, OtpCleanupService],
  exports: [AuthService],
})
export class AuthModule {}
