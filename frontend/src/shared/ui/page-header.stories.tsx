import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';
import { PageHeader } from './page-header';

const meta: Meta<typeof PageHeader> = {
  title: 'UI Kit/PageHeader',
  component: PageHeader,
  args: {
    title: 'Orders',
  },
};
export default meta;

type Story = StoryObj<typeof PageHeader>;

export const TitleOnly: Story = {};

export const WithSubtitle: Story = {
  args: { subtitle: 'Every order placed against your listings.' },
};

export const WithActions: Story = {
  args: {
    subtitle: 'Every order placed against your listings.',
    actions: <Button>Export CSV</Button>,
  },
};
