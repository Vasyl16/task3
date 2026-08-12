import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

// Internal only (used by AuthService.register) — not exposed on
// UsersController. Users never signs up "raw"; it's always via AuthModule,
// which owns credential handling (hashing, tokens).
export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  passwordHash?: string;
}
