import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge, type BadgeVariant } from './badge';

const meta: Meta<typeof Badge> = {
  title: 'UI Kit/Badge',
  component: Badge,
  argTypes: {
    variant: {
      control: 'select',
      options: ['neutral', 'success', 'danger', 'info', 'accent'],
    },
  },
  args: {
    children: 'Badge',
  },
};
export default meta;

type Story = StoryObj<typeof Badge>;

export const Neutral: Story = { args: { variant: 'neutral' } };
export const Success: Story = {
  args: { variant: 'success', children: 'Approved' },
};
export const Danger: Story = {
  args: { variant: 'danger', children: 'Rejected' },
};
export const Info: Story = { args: { variant: 'info', children: 'Pending' } };
export const Accent: Story = { args: { variant: 'accent', children: 'New' } };

const ALL_VARIANTS: BadgeVariant[] = [
  'neutral',
  'success',
  'danger',
  'info',
  'accent',
];

// Every status badge used across order/dispute/seller-application states
// side by side — the fastest way to eyeball that they stay visually
// distinct from one another.
export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
      {ALL_VARIANTS.map((variant) => (
        <Badge key={variant} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  ),
};
