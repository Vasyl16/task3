import type { Meta, StoryObj } from '@storybook/react-vite';
import { Select } from './select';

const meta: Meta<typeof Select> = {
  title: 'UI Kit/Select',
  component: Select,
  args: {
    label: 'Status',
  },
};
export default meta;

type Story = StoryObj<typeof Select>;

const options = (
  <>
    <option value="">All</option>
    <option value="NEW">New</option>
    <option value="SHIPPED">Shipped</option>
    <option value="CANCELLED">Cancelled</option>
  </>
);

export const Default: Story = {
  args: { children: options },
};

export const WithError: Story = {
  args: { children: options, error: 'Choose a status.' },
};
