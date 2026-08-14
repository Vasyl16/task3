import { Link, useNavigate } from 'react-router-dom';
import { paths } from '../../../app/routes/paths';
import { RegisterForm } from '../../../features/auth';
import { CenteredPage } from '../../../shared/ui';

export function RegisterPage() {
  const navigate = useNavigate();

  return (
    <CenteredPage title="Create account">
      {/* Registration returns tokens directly, so a new account is
          signed in already and goes straight to the app rather than
          being bounced to the login form. */}
      <RegisterForm
        onSuccess={() => void navigate(paths.home, { replace: true })}
      />
      <p style={{ textAlign: 'center', marginBottom: 0 }}>
        Already registered? <Link to={paths.login}>Sign in</Link>
      </p>
    </CenteredPage>
  );
}
