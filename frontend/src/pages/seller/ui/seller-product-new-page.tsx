import { useNavigate } from 'react-router-dom';
import { paths } from '../../../app/routes/paths';
import { Card, PageHeader } from '../../../shared/ui';
import { CreateProductForm } from '../../../features/seller-products';

export function SellerProductNewPage() {
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader title="New product" />
      <Card>
        <CreateProductForm
          onSuccess={(productId) =>
            void navigate(paths.seller.product(productId))
          }
        />
      </Card>
    </div>
  );
}
