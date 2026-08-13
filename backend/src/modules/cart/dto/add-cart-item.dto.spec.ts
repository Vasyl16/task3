import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddCartItemDto } from './add-cart-item.dto';

const VALID_BASE = {
  productId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  quantity: 1,
};

async function validateDto(overrides: Record<string, unknown>) {
  const dto = plainToInstance(AddCartItemDto, { ...VALID_BASE, ...overrides });
  return validate(dto);
}

describe('AddCartItemDto validation', () => {
  it('accepts a valid payload', async () => {
    expect(await validateDto({})).toHaveLength(0);
  });

  it('rejects a zero quantity', async () => {
    const errors = await validateDto({ quantity: 0 });
    expect(errors.some((e) => e.property === 'quantity')).toBe(true);
  });

  it('rejects a negative quantity', async () => {
    const errors = await validateDto({ quantity: -1 });
    expect(errors.some((e) => e.property === 'quantity')).toBe(true);
  });

  it('rejects a non-integer quantity', async () => {
    const errors = await validateDto({ quantity: 1.5 });
    expect(errors.some((e) => e.property === 'quantity')).toBe(true);
  });

  it('rejects a non-UUID productId', async () => {
    const errors = await validateDto({ productId: 'not-a-uuid' });
    expect(errors.some((e) => e.property === 'productId')).toBe(true);
  });
});
