import { api } from '../../../shared/api';
import type { AuthTokens } from '../../../shared/lib/token-storage';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export const sessionApi = {
  login: (body: LoginRequest) => api.post<AuthTokens>('/auth/login', body),

  register: (body: RegisterRequest) =>
    api.post<AuthTokens>('/auth/register', body),

  // skipAuthRefresh breaks what would otherwise be infinite recursion:
  // this IS the refresh call, so a 401 from it must surface as a failure
  // rather than trigger another refresh attempt.
  refresh: (refreshToken: string) =>
    api.post<AuthTokens>(
      '/auth/refresh',
      { refreshToken },
      { skipAuthRefresh: true },
    ),

  // 204 No Content. Revokes every refresh token the user holds, so it
  // signs out other tabs and devices too.
  logout: () => api.post<void>('/auth/logout'),
};
