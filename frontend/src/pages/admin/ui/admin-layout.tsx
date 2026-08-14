import { Outlet } from 'react-router-dom';
import { paths } from '../../../app/routes/paths';
import { PageHeader, Tabs } from '../../../shared/ui';

export function AdminLayout() {
  return (
    <div>
      <PageHeader title="Admin" />
      <Tabs
        items={[
          { to: paths.admin.root, label: 'Overview', end: true },
          { to: paths.admin.sellers, label: 'Seller applications' },
          { to: paths.admin.products, label: 'Product moderation' },
          { to: paths.admin.disputes, label: 'Disputes' },
        ]}
      />
      <Outlet />
    </div>
  );
}
