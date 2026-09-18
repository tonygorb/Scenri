import { expect, test } from '@playwright/test';

// Throwaway probe for PR #212's CI changes. Never merged: the probe pull request is closed and
// this branch deleted once the gate has shown what it does with a red leg.
test('ci probe fails on purpose', () => {
  expect(1).toBe(2);
});
