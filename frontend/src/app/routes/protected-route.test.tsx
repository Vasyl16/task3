import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { SessionUser } from '../../entities/session';
import type { AuthContextValue } from '../../features/auth/model/auth-context';
import {
  authenticatedAs,
  renderWithAuth,
  stubAuth,
} from '../../test/render-with-auth';
import { paths } from './paths';
import { ProtectedRoute } from './protected-route';

const customer: SessionUser = {
  id: 'user-1',
  email: 'buyer@example.com',
  role: 'CUSTOMER',
};

function renderAt(
  initialPath: string,
  auth: AuthContextValue,
  roles?: SessionUser['role'][],
) {
  return renderWithAuth(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<ProtectedRoute roles={roles} />}>
          <Route path={paths.account} element={<p>Account contents</p>} />
        </Route>
        <Route path={paths.login} element={<p>Sign in page</p>} />
        <Route path={paths.forbidden} element={<p>Forbidden page</p>} />
      </Routes>
    </MemoryRouter>,
    auth,
  );
}

describe('ProtectedRoute', () => {
  it('renders the route for an authenticated user', () => {
    renderAt(paths.account, authenticatedAs(customer));

    expect(screen.getByText('Account contents')).toBeInTheDocument();
  });

  it('redirects an anonymous visitor to the login page', () => {
    renderAt(paths.account, stubAuth());

    expect(screen.getByText('Sign in page')).toBeInTheDocument();
    expect(screen.queryByText('Account contents')).not.toBeInTheDocument();
  });

  it('waits while the session is being restored instead of redirecting', () => {
    // Without this, reloading a protected page would bounce the user to
    // login before the refresh token had a chance to restore the session.
    renderAt(paths.account, stubAuth({ status: 'restoring' }));

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Sign in page')).not.toBeInTheDocument();
  });

  it('sends a signed-in user with the wrong role to the forbidden page', () => {
    renderAt(paths.account, authenticatedAs(customer), ['ADMIN']);

    expect(screen.getByText('Forbidden page')).toBeInTheDocument();
  });

  it('admits a user whose role is in the allowed list', () => {
    renderAt(paths.account, authenticatedAs({ ...customer, role: 'ADMIN' }), [
      'ADMIN',
      'SELLER',
    ]);

    expect(screen.getByText('Account contents')).toBeInTheDocument();
  });
});
