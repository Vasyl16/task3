import { Link } from 'react-router-dom';
import { paths } from '../../../app/routes/paths';
import { EmptyState } from '../../../shared/ui';

export function NotFoundPage() {
  return (
    <EmptyState
      title="Page not found"
      description="That address doesn't match anything here."
      action={<Link to={paths.home}>Back to the marketplace</Link>}
    />
  );
}
