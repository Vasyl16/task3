import type { Meta, StoryObj } from '@storybook/react-vite';
import { Table } from './table';

const meta: Meta<typeof Table> = {
  title: 'UI Kit/Table',
  component: Table,
};
export default meta;

type Story = StoryObj<typeof Table>;

// A thin scroll+style wrapper — callers still write plain <thead>/<tbody>,
// so the story shows that real markup rather than a fake API.
export const Default: Story = {
  render: () => (
    <Table>
      <thead>
        <tr>
          <th scope="col">Order</th>
          <th scope="col">Status</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>#1042</td>
          <td>Shipped</td>
          <td>$120.00</td>
        </tr>
        <tr>
          <td>#1041</td>
          <td>Cancelled</td>
          <td>$48.50</td>
        </tr>
      </tbody>
    </Table>
  ),
};
