import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';
import { ToastProvider } from './toast';
import { useToast } from './use-toast';

// ToastProvider only renders its viewport once a toast has been pushed
// into it, so the story needs a real caller — useToast() throws outside
// the provider, which is the same contract every consumer in the app
// relies on.
function ToastDemo() {
  const { show } = useToast();
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
      <Button
        variant="secondary"
        onClick={() =>
          show({
            title: 'Saved',
            description: 'Your changes have been saved.',
            variant: 'success',
          })
        }
      >
        Show success
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          show({
            title: 'Heads up',
            description: 'Your session will expire soon.',
            variant: 'info',
          })
        }
      >
        Show info
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          show({
            title: 'Action failed',
            description: 'Could not cancel the order.',
            variant: 'danger',
          })
        }
      >
        Show danger
      </Button>
    </div>
  );
}

const meta: Meta<typeof ToastDemo> = {
  title: 'UI Kit/Toast',
  component: ToastDemo,
  decorators: [
    (Story) => (
      <ToastProvider>
        <Story />
      </ToastProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof ToastDemo>;

// Click a button — toasts stack in the corner and auto-dismiss after 6s.
export const Default: Story = {};
