import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { UserRole } from '../../entities/session';
import { useAuth } from '../../features/auth';
import { PageSpinner } from '../../shared/ui';
import { paths } from './paths';

// Route-level gating is a NAVIGATION convenience, not a security
// control. It stops a signed-out user from landing on a page that would
// only show them errors, and it hides links they cannot use. It proves
// nothing: the role it reads comes from an unverified client-side decode
// of the access token, and anyone can edit localStorage. Every request
// those pages make is authorized again by the backend against the
// signature it verifies — which is where access is actually decided.
export function ProtectedRoute({ roles }: { roles?: UserRole[] }) {
  const { status, user } = useAuth();
  const location = useLocation();

  // Without this branch, a reload on a protected page would redirect to
  // login before the refresh token had a chance to restore the session.
  if (status === 'restoring') {
    return <PageSpinner label="Restoring your session" />;
  }

  if (!user) {
    // `state.from` lets the login page send the user back where they
    // were aiming, instead of dumping everyone on the home page.
    return <Navigate to={paths.login} state={{ from: location }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={paths.forbidden} replace />;
  }

  return <Outlet />;
}
