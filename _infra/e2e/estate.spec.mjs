import { test, expect } from '@playwright/test';

test('estate search switches region, clears filters and highlights selected complex', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date());
  const [year, month] = now.split('-').map(Number);
  const months = Array.from({ length: 60 }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
  await page.route('**/estate/data/*.json', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    let body;
    if (name === 'index.json') body = { months: Object.fromEntries(['trade', 'rent'].flatMap(type => ['dongtan', 'giheung'].map(src => [`${type}:${src}`, months]))) };
    else if (name === 'geo.json') body = { refs: {}, points: { 'giheung|신갈동|1': { lat: 37.28, lng: 127.11 } }, pins: [] };
    else if (name === 'basemap.json') body = {};
    else body = { items: name.startsWith('trade-giheung-') ? [{ apt: '테스트푸르지오', dong: '신갈동', jibun: '1', built: 2000, area: 100, amt: 50000, date: `${year}-${String(month).padStart(2, '0')}-01`, canceled: false }] : [] };
    await route.fulfill({ json: body });
  });
  await page.goto('/estate/');
  await page.locator('#aptSearch').fill('테스트푸르지오');
  await page.locator('.search-hit').click();
  await expect(page.locator('#regionTabs [aria-pressed="true"]')).toHaveText('기흥구');
  await expect(page.locator('#selDong')).toHaveValue('');
  await expect(page.locator('#selBand')).toHaveValue('all');
  await expect(page.locator('#capToggle')).not.toBeChecked();
  await expect(page.locator('#aptCardBody .apt-name')).toContainText('테스트푸르지오');
  await expect(page.locator('.map-sel')).toHaveCount(1);
  await page.locator('.apt-close').click();
  await expect(page.locator('.map-sel')).toHaveCount(0);
  expect(errors).toEqual([]);
});
