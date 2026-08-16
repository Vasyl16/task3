import type { Meta, StoryObj } from '@storybook/react-vite';
import { Textarea } from './textarea';

const meta: Meta<typeof Textarea> = {
  title: 'UI Kit/Textarea',
  component: Textarea,
  args: {
    label: 'Description',
    rows: 4,
  },
};
export default meta;

type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: { placeholder: 'Describe the issue…' },
};

export const WithError: Story = {
  args: {
    defaultValue: 'x',
    error: 'Description must be at least 20 characters.',
  },
};
