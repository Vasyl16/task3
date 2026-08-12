import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

const VALID_BASE = {
  categoryId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  name: 'Widget',
  slug: 'widget',
  basePrice: 9.99,
  initialQuantity: 5,
};

async function validateDto(overrides: Record<string, unknown>) {
  const dto = plainToInstance(CreateProductDto, {
    ...VALID_BASE,
    ...overrides,
  });
  return validate(dto);
}

describe('CreateProductDto validation', () => {
  it('accepts a valid payload', async () => {
    const errors = await validateDto({});
    expect(errors).toHaveLength(0);
  });

  it('rejects a zero price', async () => {
    const errors = await validateDto({ basePrice: 0 });
    expect(errors.some((e) => e.property === 'basePrice')).toBe(true);
  });

  it('rejects a negative price', async () => {
    const errors = await validateDto({ basePrice: -5 });
    expect(errors.some((e) => e.property === 'basePrice')).toBe(true);
  });

  it('rejects a negative stock quantity', async () => {
    const errors = await validateDto({ initialQuantity: -1 });
    expect(errors.some((e) => e.property === 'initialQuantity')).toBe(true);
  });

  it('rejects a non-integer stock quantity', async () => {
    const errors = await validateDto({ initialQuantity: 1.5 });
    expect(errors.some((e) => e.property === 'initialQuantity')).toBe(true);
  });

  it('rejects a non-UUID categoryId', async () => {
    const errors = await validateDto({ categoryId: 'not-a-uuid' });
    expect(errors.some((e) => e.property === 'categoryId')).toBe(true);
  });

  it('accepts a zero stock quantity (out-of-stock listing is valid)', async () => {
    const errors = await validateDto({ initialQuantity: 0 });
    expect(errors).toHaveLength(0);
  });
});
