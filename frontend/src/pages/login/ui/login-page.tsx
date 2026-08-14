import { Link, useLocation, useNavigate } from 'react-router-dom';
import { paths } from '../../../app/routes/paths';
import { LoginForm } from '../../../features/auth';
import { CenteredPage } from '../../../shared/ui';

interface RedirectState {
  from?: { pathname: string };
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // Set by ProtectedRoute when it turned someone away. Falling back to
  // home keeps a directly-visited /login working.
  const redirectTo =
    (location.state as RedirectState | null)?.from?.pathname ?? paths.home;

  return (
    <CenteredPage title="Sign in">
      <LoginForm
        onSuccess={() => void navigate(redirectTo, { replace: true })}
      />
      <p style={{ textAlign: 'center', marginBottom: 0 }}>
        No account yet? <Link to={paths.register}>Create one</Link>
      </p>
    </CenteredPage>
  );
}
