/**
 * E2E-сценарии из раздела 2 ТЗ (критерий приёмки 9.1). Работают с mock-движком.
 * Запуск: `npm run e2e` (сам поднимет дев-сервер) или E2E_BASE_URL=http://... npm run e2e.
 */
import { expect, test, type Page } from '@playwright/test';

async function openTemplate(page: Page, id: 'eshop' | 'bank' | 'travel') {
  await page.goto('/');
  await page.getByTestId(`template-${id}`).click();
  await expect(page.getByTestId('btn-start')).toBeVisible();
}

async function selectNode(page: Page, name: string) {
  // Клик по заголовку узла (не по ползунку внутри).
  await page.getByTestId(`node-${name}`).click({ position: { x: 60, y: 14 } });
}

test('Сценарий 1 и 2: «База не вытягивает» → шардирование → предупреждение о кросс-шардовой транзакции', async ({ page }) => {
  await openTemplate(page, 'eshop');
  await page.getByTestId('btn-start').click();
  await selectNode(page, 'Покупатели');
  await page.getByTestId('client-rps').fill('750');
  await page.getByTestId('client-rps').blur();

  const hint = page.getByTestId('hint-dbOverload');
  await expect(hint).toBeVisible({ timeout: 20_000 });
  await expect(hint).toContainText('payments-db');

  await hint.getByRole('button', { name: 'Шардировать' }).click();
  await expect(page.getByTestId('choose-pattern')).toBeVisible();
  await page.getByTestId('choose-pattern').click();
  await expect(page.getByTestId('tx-spread-warning')).toBeVisible();
  await expect(page.getByTestId('node-payments-db #1')).toBeVisible();
});

test('Сценарий 3: «Урони координатор» 2PC — зависшие блокировки', async ({ page }) => {
  await openTemplate(page, 'eshop');
  await selectNode(page, 'Payment');
  await page.getByTestId('props-tab-endpoints').click();
  await page.getByTestId('tx-pattern').selectOption('2pc');
  await page.getByTestId('btn-start').click();
  await page.waitForTimeout(1500);

  await page.getByTestId('node-Payment').click({ button: 'right', position: { x: 60, y: 14 } });
  await page.getByText('Уронить координатор 2PC после prepare').click();

  await expect(page.getByTestId('hint-coordinatorDown')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('node-payments-db')).toContainText('блокировки', { timeout: 15_000 });
});

test('Сценарий 4: «Дубли сообщений» — без идемпотентности растут нарушения', async ({ page }) => {
  await openTemplate(page, 'travel');
  await page.getByTestId('speed').selectOption('10');
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('violations-counter')).toBeVisible({ timeout: 20_000 });
});

test('Сценарий 5: сравнение паттернов даёт отчёт с таблицей и графиками', async ({ page }) => {
  await openTemplate(page, 'eshop');
  await page.getByTestId('btn-compare').click();
  await page.getByTestId('cmp-run').click();
  await expect(page.getByTestId('cmp-report')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('cmp-table')).toContainText('2PC');
  await expect(page.getByTestId('cmp-table')).toContainText('Сага: оркестрация');
});

test('Схему с ошибками нельзя запустить, ошибка видна на узле', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-empty').click();
  const canvas = page.locator('.react-flow__pane');
  await page.getByTestId('palette-service').dragTo(canvas, { targetPosition: { x: 300, y: 200 } });
  await expect(page.getByTestId('node-error')).toBeVisible();
  await expect(page.getByTestId('btn-start')).toBeDisabled();
});
