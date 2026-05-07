import { describe, expect, it } from 'vitest';
import { renderTemplate, renderTemplateStrict } from '../src/core/render.js';

describe('renderTemplate', () => {
  it('substitutes variables', () => {
    expect(renderTemplate('Hi {{name}}, {{hook}}', { name: 'Ilia', hook: 'great post' })).toBe(
      'Hi Ilia, great post',
    );
  });

  it('allows whitespace inside braces', () => {
    expect(renderTemplate('Hi {{ name }}', { name: 'Ilia' })).toBe('Hi Ilia');
  });

  it('leaves unknown vars in place for visibility in preview', () => {
    expect(renderTemplate('Hi {{name}}, {{role}}', { name: 'Ilia' })).toBe('Hi Ilia, {{role}}');
  });

  it('treats empty/undefined value as missing (preserves placeholder)', () => {
    expect(renderTemplate('Hi {{name}}', { name: '' })).toBe('Hi {{name}}');
    expect(renderTemplate('Hi {{name}}', { name: undefined })).toBe('Hi {{name}}');
  });
});

describe('renderTemplateStrict', () => {
  it('substitutes when all vars present', () => {
    expect(renderTemplateStrict('Hi {{name}}', { name: 'Ilia' })).toBe('Hi Ilia');
  });

  it('throws when a referenced var is missing', () => {
    expect(() => renderTemplateStrict('Hi {{name}} {{role}}', { name: 'Ilia' })).toThrowError(
      /unresolved variables: role/,
    );
  });

  it('reports all missing vars at once', () => {
    expect(() => renderTemplateStrict('{{a}} {{b}} {{c}}', { a: 'x' })).toThrowError(/b, c/);
  });
});
