import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { SessionUser } from '../entities/session';
import { AuthContext } from '../features/auth/model/auth-context';
import type { AuthContextValue } from '../features/auth/model/auth-context';

// Puts the tree under test into a given session state directly, with no
// real provider, tokens, or network. Exports only helpers and no
// component, which keeps React Fast Refresh's one-kind-per-file rule
// satisfied.

export function stubAuth(
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  return {
    status: 'anonymous',
    user: null,
    login: () => Promise.resolve(),
    register: () => Promise.resolve(),
    logout: () => Promise.resolve(),
    ...overrides,
  };
}

export function authenticatedAs(user: SessionUser): AuthContextValue {
  return stubAuth({ status: 'authenticated', user });
}

export function renderWithAuth(
  ui: ReactElement,
  auth: AuthContextValue = stubAuth(),
) {
  return render(<AuthContext.Provider value={auth}>{ui}</AuthContext.Provider>);
}
