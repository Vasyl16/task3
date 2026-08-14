import { Link } from 'react-router-dom';
import { paths } from '../../../app/routes/paths';
import { EmptyState } from '../../../shared/ui';

export function ForbiddenPage() {
  return (
    <EmptyState
      title="Not available for your account"
      description="You're signed in, but this area needs a different role."
      action={<Link to={paths.home}>Back to the marketplace</Link>}
    />
  );
}
