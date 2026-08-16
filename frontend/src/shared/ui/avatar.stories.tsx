import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar } from './avatar';

const meta: Meta<typeof Avatar> = {
  title: 'UI Kit/Avatar',
  component: Avatar,
  args: {
    name: 'Vasyl Yurchuk',
  },
};
export default meta;

type Story = StoryObj<typeof Avatar>;

export const Default: Story = {};

export const LargeSize: Story = {
  args: { size: 64 },
};

export const SingleWordName: Story = {
  args: { name: 'Marketplace' },
};

// Same name always resolves to the same gradient + initials (see the
// component's hashString comment) — two instances of this story render
// identically on every reload, which is the property being demonstrated.
export const Deterministic: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
      <Avatar name="Oksana Petrenko" />
      <Avatar name="Oksana Petrenko" />
      <Avatar name="Ihor Bondarenko" />
    </div>
  ),
};
