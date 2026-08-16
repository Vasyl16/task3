import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Pagination } from './pagination';

const meta: Meta<typeof Pagination> = {
  title: 'UI Kit/Pagination',
  component: Pagination,
};
export default meta;

type Story = StoryObj<typeof Pagination>;

// Stateful so Previous/Next are actually clickable in the canvas, not
// just a static frame of one page.
export const Interactive: Story = {
  render: function Render() {
    const [page, setPage] = useState(1);
    return (
      <Pagination page={page} limit={10} total={97} onPageChange={setPage} />
    );
  },
};

export const FirstPage: Story = {
  args: { page: 1, limit: 10, total: 97, onPageChange: () => {} },
};

export const LastPage: Story = {
  args: { page: 10, limit: 10, total: 97, onPageChange: () => {} },
};

// A single page of results needs no controls at all — this story
// intentionally renders nothing, which is the component's own contract.
export const SinglePage: Story = {
  args: { page: 1, limit: 10, total: 4, onPageChange: () => {} },
};
