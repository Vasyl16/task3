import { useState } from 'react';
import type { SellerProfileStatus } from '../../../entities/seller';
import {
  SellerStatusBadge,
  useAdminSellerApplications,
} from '../../../entities/seller';
import { formatDateTime } from '../../../shared/lib';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
  Select,
  Table,
} from '../../../shared/ui';
import { ReviewSellerApplicationControl } from '../../../features/admin-sellers';

const STATUSES: SellerProfileStatus[] = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
];

export function AdminSellersPage() {
  const [status, setStatus] = useState<SellerProfileStatus | ''>('PENDING');
  const {
    data: applications,
    error,
    isPending,
    refetch,
  } = useAdminSellerApplications(status ? { status } : undefined);

  return (
    <div>
      <PageHeader
        title="Seller applications"
        actions={
          <Select
            label="Status"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as SellerProfileStatus | '')
            }
          >
            <option value="">All</option>
            {STATUSES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        }
      />

      {isPending && <PageSpinner label="Loading applications" />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {applications && applications.length === 0 && (
        <EmptyState
          title="No applications"
          description="Nothing matches this filter."
        />
      )}
      {applications && applications.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th scope="col">Business</th>
              <th scope="col">Applied</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((application) => (
              <tr key={application.id}>
                <td>{application.businessName}</td>
                <td>{formatDateTime(application.appliedAt)}</td>
                <td>
                  <SellerStatusBadge status={application.status} />
                </td>
                <td>
                  <ReviewSellerApplicationControl profile={application} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
