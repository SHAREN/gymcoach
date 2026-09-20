import { describe, expect, it } from 'vitest';
import { shouldHideAppChrome } from './app-shell';

describe('shouldHideAppChrome', () => {
  it('hides normal app chrome for active workout routes', () => {
    expect(shouldHideAppChrome('/session/session-123')).toBe(true);
    expect(shouldHideAppChrome('/session/session-123/details')).toBe(true);
  });

  it('keeps normal app chrome on the workout chooser and other app pages', () => {
    expect(shouldHideAppChrome('/session/new')).toBe(false);
    expect(shouldHideAppChrome('/')).toBe(false);
    expect(shouldHideAppChrome('/history')).toBe(false);
  });
});
