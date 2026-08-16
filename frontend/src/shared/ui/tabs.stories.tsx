import type { Meta, StoryObj } from '@storybook/react-vite';
import { Tabs } from './tabs';

const meta: Meta<typeof Tabs> = {
  title: 'UI Kit/Tabs',
  component: Tabs,
  // The global MemoryRouter decorator (.storybook/preview.tsx) supplies
  // the router context every NavLink here needs.
  args: {
    items: [
      { to: '/', label: 'Overview', end: true },
      { to: '/orders', label: 'Orders' },
      { to: '/listings', label: 'Listings' },
    ],
  },
};
export default meta;

type Story = StoryObj<typeof Tabs>;

export const Default: Story = {};
