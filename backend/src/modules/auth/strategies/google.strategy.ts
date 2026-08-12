import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import {
  Strategy,
  type Profile,
  type VerifyCallback,
} from 'passport-google-oauth20';
import type { AppConfig } from '../../../config/configuration';

// Only registered by AuthModule when GOOGLE_CLIENT_ID/SECRET are actually
// set (see auth.module.ts) — passport-google-oauth20 throws at
// construction time on an empty clientID, which would otherwise crash
// app bootstrap for anyone who hasn't configured Google OAuth.
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService<AppConfig, true>) {
    super({
      clientID: configService.get('googleOAuth.clientId', { infer: true }),
      clientSecret: configService.get('googleOAuth.clientSecret', {
        infer: true,
      }),
      callbackURL: configService.get('googleOAuth.callbackUrl', {
        infer: true,
      }),
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) {
    const email = profile.emails?.[0]?.value;
    const name = profile.displayName;
    if (!email) {
      done(new Error('Google profile did not include an email'), false);
      return;
    }
    done(null, { email, name: name ?? email });
  }
}
