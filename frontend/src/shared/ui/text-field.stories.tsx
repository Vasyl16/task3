import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextField } from './text-field';

const meta: Meta<typeof TextField> = {
  title: 'UI Kit/TextField',
  component: TextField,
  args: {
    label: 'Email',
  },
};
export default meta;

type Story = StoryObj<typeof TextField>;

export const Default: Story = {
  args: { type: 'email', placeholder: 'you@example.com' },
};

export const WithError: Story = {
  args: {
    type: 'email',
    defaultValue: 'not-an-email',
    error: 'Enter a valid email address.',
  },
};

export const Disabled: Story = {
  args: { defaultValue: 'you@example.com', disabled: true },
};
