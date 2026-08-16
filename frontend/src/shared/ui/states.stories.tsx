import type { Meta, StoryObj } from '@storybook/react-vite';
import { ApiError } from '../api/api-error';
import { Button } from './button';
import { EmptyState, ErrorState } from './states';

const meta: Meta<typeof ErrorState> = {
  title: 'UI Kit/States',
  component: ErrorState,
};
export default meta;

type Story = StoryObj<typeof ErrorState>;

export const ErrorWithRetry: Story = {
  args: {
    error: ApiError.network('Could not reach the server.'),
    onRetry: () => {},
  },
};

export const ErrorWithoutRetry: Story = {
  args: {
    error: new ApiError(403, ["You don't have access to this order."]),
  },
};

export const Empty: Story = {
  render: () => (
    <EmptyState
      title="No orders yet"
      description="Orders placed against your listings will show up here."
    />
  ),
};

export const EmptyWithAction: Story = {
  render: () => (
    <EmptyState
      title="No listings yet"
      description="Create your first listing to start selling."
      action={<Button>Create listing</Button>}
    />
  ),
};
