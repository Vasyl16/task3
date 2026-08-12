import { Injectable, NotImplementedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import type { AuthTokens } from './domain/auth-tokens.interface';
import type { LoginDto } from './dto/login.dto';
import type { RefreshDto } from './dto/refresh.dto';
import type { RegisterDto } from './dto/register.dto';

// Credential hashing (bcrypt/argon2) and JWT signing (@nestjs/jwt +
// passport) aren't wired up yet — that's the next, business-logic pass.
// This module only establishes the boundary: Auth owns credentials/tokens,
// Users owns profile identity, and Auth depends on Users (never the
// reverse).
@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  register(_dto: RegisterDto): Promise<AuthTokens> {
    // Will: hash password, this.usersService.create({ email, name,
    // passwordHash }), then issue tokens.
    throw new NotImplementedException('AuthService.register');
  }

  login(_dto: LoginDto): Promise<AuthTokens> {
    // Will: this.usersService.findByEmail, verify hash, issue tokens.
    throw new NotImplementedException('AuthService.login');
  }

  refresh(_dto: RefreshDto): Promise<AuthTokens> {
    // Will: verify + rotate refresh token, issue a new token pair.
    throw new NotImplementedException('AuthService.refresh');
  }
}
