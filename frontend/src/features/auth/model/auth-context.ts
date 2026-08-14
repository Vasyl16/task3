import { createContext } from 'react';
import type { SessionUser } from '../../../entities/session';
import type { LoginRequest, RegisterRequest } from '../../../entities/session';

export type AuthStatus = 'restoring' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  // Null whenever status is not 'authenticated'.
  user: SessionUser | null;
  login: (credentials: LoginRequest) => Promise<void>;
  register: (details: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
}

// Separate module from the provider component on purpose: a file that
// exports both a component and a non-component breaks React Fast
// Refresh (and trips react-refresh/only-export-components).
export const AuthContext = createContext<AuthContextValue | null>(null);
