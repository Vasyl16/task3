import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthThrottle } from '../../core/auth/decorators/auth-throttle.decorator';
import { ApiAuth } from '../../core/openapi/api-auth.decorator';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import { Public } from '../../core/auth/decorators/public.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { AuthService } from './auth.service';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

// register/login/refresh carry the strict credential rate limit (see
// CoreModule's AUTH_THROTTLE): they are the endpoints where an unlimited
// request rate turns straight into password guessing or refresh-token
// brute forcing. Everything else in the app gets the generous default
// limit instead.
@ApiTags('auth')
@ApiResponse({
  status: 429,
  description:
    'Strict credential rate limit exceeded — see THROTTLE_AUTH_LIMIT.',
})
@AuthThrottle()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({
    summary: 'Register a new account',
    description:
      'Creates a CUSTOMER and returns a token pair immediately — there is ' +
      'no email-confirmation step. Becoming a SELLER is a separate, ' +
      'admin-approved flow (see POST /sellers/apply).',
  })
  @ApiCreatedResponse({ description: 'Account created; token pair returned.' })
  @ApiResponse({
    status: 400,
    description: 'Invalid email, or password shorter than 8 characters.',
  })
  @ApiResponse({ status: 409, description: 'Email is already registered.' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  @ApiOperation({
    summary: 'Log in',
    description:
      'Returns a token pair. A wrong password and an unknown email give ' +
      'the same 401 on purpose — the response must not reveal which ' +
      'addresses have accounts.',
  })
  @ApiOkResponse({ description: 'Authenticated; token pair returned.' })
  @ApiResponse({ status: 401, description: 'Invalid email or password.' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  @ApiOperation({
    summary: 'Rotate the token pair',
    description:
      'Consumes the presented refresh token and issues a brand new pair. ' +
      'Re-presenting an already-rotated token is treated as theft, not a ' +
      'mistake: every session for that user is revoked and the call fails.',
  })
  @ApiOkResponse({ description: 'Rotated; new token pair returned.' })
  @ApiResponse({
    status: 401,
    description:
      'Token invalid, expired, or already used — the last of which also ' +
      'revokes every other session for that user.',
  })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  @ApiAuth()
  @ApiOperation({
    summary: 'Log out of every session',
    description:
      'Revokes all refresh tokens for the caller. Already-issued access ' +
      'tokens remain valid until they expire — they are stateless by ' +
      'design and are not checked against the database per request.',
  })
  @ApiNoContentResponse({ description: 'All sessions revoked.' })
  async logout(@CurrentUser() user: AuthenticatedUser) {
    await this.authService.logout(user.id);
  }

  // Google OAuth is only reachable when GOOGLE_CLIENT_ID/SECRET are
  // configured — see auth.module.ts, which registers GoogleStrategy
  // conditionally. Without it, this route 500s with a clear "Unknown
  // authentication strategy" error rather than crashing app bootstrap.
  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('google')
  @ApiOperation({
    summary: 'Start Google OAuth (redirects to Google)',
    description:
      'Only reachable when GOOGLE_CLIENT_ID/SECRET are configured; ' +
      'otherwise this 500s with "Unknown authentication strategy". Not a ' +
      'JSON endpoint — open it in a browser.',
  })
  googleLogin() {
    // Handled entirely by GoogleAuthGuard, which redirects to Google.
  }

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('google/callback')
  @ApiOperation({
    summary: 'Google OAuth callback',
    description:
      'Find-or-create by email, then issues OUR token pair. Google’s own ' +
      'tokens never leave the server.',
  })
  googleCallback(@Req() req: Request) {
    const profile = req.user as { email: string; name: string };
    return this.authService.loginWithGoogleProfile(profile);
  }
}
