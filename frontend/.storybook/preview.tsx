import type { Preview } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import '../src/app/index.css';

// The design tokens (--color-*, --space-*, --radius) and component
// styles both live behind this one import (see app/index.css's own
// comment) — pulling it in here is what makes every story look like
// the real app instead of unstyled HTML.
//
// MemoryRouter is global rather than per-story because Tabs (and any
// future ui-kit component) renders a react-router NavLink, and this is
// the same "auth/router is injected, not imported" boundary shared/ui
// already respects — Storybook just has to supply what App.tsx normally
// would.
const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: 'todo',
    },
  },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div style={{ padding: 'var(--space-4)' }}>
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
};

export default preview;
