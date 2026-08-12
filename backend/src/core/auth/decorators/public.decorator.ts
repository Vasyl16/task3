import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Marks a route as exempt from the global JwtAuthGuard (login, register,
// refresh, health, public catalog browsing).
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
