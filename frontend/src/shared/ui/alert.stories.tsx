import type { Meta, StoryObj } from '@storybook/react-vite';
import { ApiError } from '../api/api-error';
import { Alert, ErrorAlert } from './alert';

const meta: Meta<typeof Alert> = {
  title: 'UI Kit/Alert',
  component: Alert,
};
export default meta;

type Story = StoryObj<typeof Alert>;

export const Info: Story = {
  args: { variant: 'info', children: 'Your changes have been saved.' },
};

export const Error: Story = {
  args: {
    variant: 'error',
    children: 'Something went wrong. Please try again.',
  },
};

// ErrorAlert renders whatever a mutation/query threw, via toUserMessage —
// a 400 from class-validator carries one message per failed constraint,
// so every one of them is listed, not just the first.
export const FromSingleApiError: Story = {
  render: () => (
    <ErrorAlert error={new ApiError(404, ['Product not found.'])} />
  ),
};

export const FromMultiMessageApiError: Story = {
  render: () => (
    <ErrorAlert
      error={
        new ApiError(400, [
          'email must be an email',
          'password must be at least 8 characters',
        ])
      }
    />
  ),
};
