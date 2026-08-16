import type { Meta, StoryObj } from '@storybook/react-vite';
import { BrandMark } from './brand-mark';

const meta: Meta<typeof BrandMark> = {
  title: 'UI Kit/BrandMark',
  component: BrandMark,
};
export default meta;

type Story = StoryObj<typeof BrandMark>;

export const Default: Story = {};

export const Large: Story = {
  args: { size: 44 },
};
