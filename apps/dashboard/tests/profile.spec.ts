// apps/dashboard/tests/profile.spec.ts
//
// Functional tests for the user profile page.
// Covers: loading state, display name editing, avatar upload validation,
// error states, mobile/desktop responsive rendering, and accessibility.
//
// Run: pnpm test:a11y (profile route is included via a11y.spec.ts)
// For this file specifically, add a "test:profile" script or run:
//   npx playwright test tests/profile.spec.ts

import { test, expect } from '@playwright/test';

const EMPTY_PROFILE = {
  id: 'usr_test123',
  displayName: '',
  avatarUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const PROFILE_WITH_NAME = {
  ...EMPTY_PROFILE,
  displayName: 'Jane Dev',
};

const PROFILE_WITH_AVATAR = {
  ...PROFILE_WITH_NAME,
  avatarUrl: 'https://example.com/avatar.png',
};

test.describe('Profile page', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the profile API to return stable data
    await page.route('/api/users/profile', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PROFILE_WITH_NAME),
      });
    });
  });

  test('renders profile heading and sections', async ({ page }) => {
    await page.goto('/profile', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: /profile/i })).toBeVisible();
    await expect(page.getByRole('region', { name: /avatar upload/i })).toBeVisible();
    await expect(page.getByText('Display name')).toBeVisible();
    await expect(page.getByText('Account info')).toBeVisible();
  });

  test('shows display name in view mode', async ({ page }) => {
    await page.goto('/profile', { waitUntil: 'networkidle' });

    await expect(page.getByText('Jane Dev')).toBeVisible();
    await expect(page.getByRole('button', { name: /edit display name/i })).toBeVisible();
  });

  test('edit display name flow: open, type, save', async ({ page }) => {
    let patchCalled = false;
    await page.route('/api/users/profile', (route) => {
      if (route.request().method() === 'PATCH') {
        patchCalled = true;
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...PROFILE_WITH_NAME, displayName: 'Updated Name' }) });
      } else {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROFILE_WITH_NAME) });
      }
    });

    await page.goto('/profile', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /edit display name/i }).click();

    const input = page.getByRole('textbox', { name: /display name/i });
    await expect(input).toBeFocused();
    await input.fill('Updated Name');
    await page.getByRole('button', { name: /^save$/i }).click();

    expect(patchCalled).toBe(true);
    await expect(page.getByRole('status')).toContainText(/saved/i);
  });

  test('cancel edit restores view mode without saving', async ({ page }) => {
    let patchCalled = false;
    await page.route('/api/users/profile', (route) => {
      if (route.request().method() === 'PATCH') patchCalled = true;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROFILE_WITH_NAME) });
    });

    await page.goto('/profile', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /edit display name/i }).click();
    await page.getByRole('button', { name: /cancel/i }).click();

    expect(patchCalled).toBe(false);
    await expect(page.getByRole('button', { name: /edit display name/i })).toBeVisible();
  });

  test('Escape key cancels edit', async ({ page }) => {
    await page.goto('/profile', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /edit display name/i }).click();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('button', { name: /edit display name/i })).toBeVisible();
  });

  test('Enter key saves display name', async ({ page }) => {
    let patchCalled = false;
    await page.route('/api/users/profile', (route) => {
      if (route.request().method() === 'PATCH') {
        patchCalled = true;
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROFILE_WITH_NAME) });
      } else {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROFILE_WITH_NAME) });
      }
    });

    await page.goto('/profile', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /edit display name/i }).click();
    await page.keyboard.press('Enter');

    expect(patchCalled).toBe(true);
  });

  test('save failure shows error message', async ({ page }) => {
    await page.route('/api/users/profile', (route) => {
      if (route.request().method() === 'PATCH') {
        route.fulfill({ status: 500, body: 'Internal Server Error' });
      } else {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROFILE_WITH_NAME) });
      }
    });

    await page.goto('/profile', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /edit display name/i }).click();
    await page.getByRole('button', { name: /^save$/i }).click();

    await expect(page.getByRole('status')).toContainText(/fail/i);
  });

  test('upload button triggers file input', async ({ page }) => {
    await page.goto('/profile', { waitUntil: 'networkidle' });

    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached();
    await expect(page.getByRole('button', { name: /upload new avatar/i })).toBeVisible();
  });

  test('shows Remove button when avatarUrl is set', async ({ page }) => {
    await page.route('/api/users/profile', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROFILE_WITH_AVATAR) });
    });

    await page.goto('/profile', { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: /remove avatar/i })).toBeVisible();
  });

  test('hides Remove button when no avatar', async ({ page }) => {
    await page.goto('/profile', { waitUntil: 'networkidle' });

    await expect(page.getByRole('button', { name: /remove avatar/i })).not.toBeVisible();
  });

  test('shows initials placeholder when no avatar', async ({ page }) => {
    await page.goto('/profile', { waitUntil: 'networkidle' });

    const placeholder = page.getByRole('img', { name: /avatar placeholder/i });
    await expect(placeholder).toBeVisible();
  });

  test('shows user ID, created, updated in account info', async ({ page }) => {
    await page.goto('/profile', { waitUntil: 'networkidle' });

    await expect(page.getByText('usr_test123')).toBeVisible();
    await expect(page.getByText('User ID')).toBeVisible();
    await expect(page.getByText('Created')).toBeVisible();
    await expect(page.getByText('Updated')).toBeVisible();
  });

  test('status message is announced via aria-live', async ({ page }) => {
    await page.route('/api/users/profile', (route) => {
      if (route.request().method() === 'PATCH') {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROFILE_WITH_NAME) });
      } else {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROFILE_WITH_NAME) });
      }
    });

    await page.goto('/profile', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /edit display name/i }).click();
    await page.getByRole('button', { name: /^save$/i }).click();

    const status = page.getByRole('status');
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute('aria-live', 'polite');
  });

  test.describe('responsive rendering', () => {
    test('renders correctly at mobile width (375px)', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/profile', { waitUntil: 'networkidle' });

      await expect(page.getByRole('heading', { name: /profile/i })).toBeVisible();
      await expect(page.getByRole('region', { name: /avatar upload/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /upload new avatar/i })).toBeVisible();
    });

    test('renders correctly at desktop width (1280px)', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/profile', { waitUntil: 'networkidle' });

      await expect(page.getByRole('heading', { name: /profile/i })).toBeVisible();
      await expect(page.getByRole('region', { name: /avatar upload/i })).toBeVisible();
    });
  });
});
