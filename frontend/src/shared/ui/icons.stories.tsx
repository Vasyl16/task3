import type { Meta, StoryObj } from '@storybook/react-vite';
import { BellIcon, CartIcon, OrdersIcon, UserIcon } from './icons';

// No single exported "Icons" component to point Meta at — this gallery
// exists only so every glyph in the set can be seen, and diffed, at once.
function IconGallery() {
  const icons = [
    { name: 'CartIcon', Icon: CartIcon },
    { name: 'OrdersIcon', Icon: OrdersIcon },
    { name: 'UserIcon', Icon: UserIcon },
    { name: 'BellIcon', Icon: BellIcon },
  ];
  return (
    <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
      {icons.map(({ name, Icon }) => (
        <div
          key={name}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-1)',
          }}
        >
          <Icon />
          <span
            style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}
          >
            {name}
          </span>
        </div>
      ))}
    </div>
  );
}

const meta: Meta<typeof IconGallery> = {
  title: 'UI Kit/Icons',
  component: IconGallery,
};
export default meta;

type Story = StoryObj<typeof IconGallery>;

export const AllIcons: Story = {};
