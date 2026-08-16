import type { Meta, StoryObj } from '@storybook/react-vite';
import { BarChart, type BarChartPoint } from './bar-chart';

const meta: Meta<typeof BarChart> = {
  title: 'UI Kit/BarChart',
  component: BarChart,
};
export default meta;

type Story = StoryObj<typeof BarChart>;

const WEEKLY_REVENUE: BarChartPoint[] = [
  { label: 'Mon', value: 420 },
  { label: 'Tue', value: 380 },
  { label: 'Wed', value: 610 },
  { label: 'Thu', value: 290 },
  { label: 'Fri', value: 740 },
  { label: 'Sat', value: 905 },
  { label: 'Sun', value: 512 },
];

export const Default: Story = {
  args: {
    points: WEEKLY_REVENUE,
    ariaLabel: 'Revenue by day, last 7 days',
    formatValue: (value) => `$${value}`,
  },
};

// A longer series to exercise the hit-target-bigger-than-the-mark
// behaviour once bars are only a few pixels wide.
export const ManyPoints: Story = {
  args: {
    points: Array.from({ length: 30 }, (_, i) => ({
      label: `Day ${i + 1}`,
      value: Math.round(200 + Math.random() * 800),
    })),
    ariaLabel: 'Revenue by day, last 30 days',
    formatValue: (value) => `$${value}`,
  },
};
