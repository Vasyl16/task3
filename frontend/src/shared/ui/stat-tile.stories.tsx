import type { Meta, StoryObj } from '@storybook/react-vite';
import { StatTile } from './stat-tile';

const meta: Meta<typeof StatTile> = {
  title: 'UI Kit/StatTile',
  component: StatTile,
  args: {
    label: 'Revenue',
    value: '$12,480',
  },
};
export default meta;

type Story = StoryObj<typeof StatTile>;

export const Up: Story = {
  args: { deltaPct: 12.4 },
};

export const Down: Story = {
  args: { deltaPct: -5.1 },
};

export const Flat: Story = {
  args: { deltaPct: 0 },
};

// No period-over-period figure to compare against yet.
export const NoComparison: Story = {
  args: { deltaPct: null },
};
