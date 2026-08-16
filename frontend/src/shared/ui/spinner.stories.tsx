import type { Meta, StoryObj } from '@storybook/react-vite';
import { PageSpinner, Spinner } from './spinner';

const meta: Meta<typeof Spinner> = {
  title: 'UI Kit/Spinner',
  component: Spinner,
};
export default meta;

type Story = StoryObj<typeof Spinner>;

export const Small: Story = {};

export const Large: Story = {
  args: { size: 'lg' },
};

// label="" for a spinner sitting inside a control that already has its
// own accessible name (e.g. a loading Button) — see the component's own
// comment on why this must not announce twice.
export const Unlabeled: Story = {
  args: { label: '' },
};

// The full-page centered variant used for route-level loading states.
export const PageLoading: Story = {
  render: () => <PageSpinner />,
};
