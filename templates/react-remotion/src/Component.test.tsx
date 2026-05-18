import { describe, expect, it } from 'vitest';
import { defaultProps, propsSchema } from './schema';

describe('__COMPONENT_NAME__ props schema', () => {
  it('provides bounded default preview props', () => {
    expect(propsSchema.parse(defaultProps)).toMatchObject({
      title: '__DISPLAY_NAME__',
    });
  });
});
