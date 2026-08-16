import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';
import { CenteredPage } from './centered-page';
import { TextField } from './text-field';

const meta: Meta<typeof CenteredPage> = {
  title: 'UI Kit/CenteredPage',
  component: CenteredPage,
  args: {
    title: 'Sign in',
  },
};
export default meta;

type Story = StoryObj<typeof CenteredPage>;

// The shared shell behind the login/register screens — one branded card
// centered on the page.
export const Default: Story = {
  render: (args) => (
    <CenteredPage {...args}>
      <TextField label="Email" type="email" />
      <div style={{ marginTop: 'var(--space-3)' }}>
        <Button type="submit">Continue</Button>
      </div>
    </CenteredPage>
  ),
};
