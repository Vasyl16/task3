import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card } from './card';

const meta: Meta<typeof Card> = {
  title: 'UI Kit/Card',
  component: Card,
};
export default meta;

type Story = StoryObj<typeof Card>;

export const Default: Story = {
  render: (args) => (
    <Card {...args} style={{ maxWidth: 320 }}>
      <h3 style={{ margin: 0 }}>Card title</h3>
      <p style={{ margin: 'var(--space-2) 0 0' }}>
        Plain content — Card only owns the surface, padding, and border.
      </p>
    </Card>
  ),
};

export const Tight: Story = {
  args: { tight: true },
  render: (args) => (
    <Card {...args} style={{ maxWidth: 320 }}>
      <p style={{ margin: 0 }}>Reduced padding, for dense list rows.</p>
    </Card>
  ),
};

export const Interactive: Story = {
  args: { interactive: true },
  render: (args) => (
    <Card {...args} style={{ maxWidth: 320 }}>
      <p style={{ margin: 0 }}>Hover/focus affordance for a clickable card.</p>
    </Card>
  ),
};
