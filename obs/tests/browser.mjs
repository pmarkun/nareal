// CI runner: no connected Browser plugin or user session.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory = process.env.OBS_QA_OUTPUT || '/tmp/nareal-qa';
await fs.mkdir(directory, {recursive: true});
const browser = await chromium.launch({headless: true});
const page = await browser.newPage({viewport: {width: 1440, height: 1050}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {if (message.type() === 'error' && !message.text().includes('favicon')) errors.push(message.text());});
try {
  await page.goto('http://127.0.0.1:8766/');
  assert.match(await page.title(), /Na Real/);
  await page.getByLabel('Chave do operador').fill('fixture-token-not-a-real-user-secret');
  await page.getByRole('button', {name: 'Entrar', exact: true}).click();
  await page.getByRole('heading', {name: 'Escutar. Checar. Exibir.'}).waitFor();
  await page.getByRole('button', {name: /Este é um exemplo fictício/}).click();
  await page.getByLabel('Afirmação analisada').fill('Resumo corrigido no teste de interface');
  assert.equal(await page.getByRole('button', {name: 'Aprovar e exibir'}).isEnabled(), false);
  await page.getByRole('button', {name: 'Salvar revisão', exact: true}).click();
  await page.waitForFunction(() => !document.getElementById('approve').disabled);
  await page.getByRole('button', {name: 'Aprovar e exibir'}).click();
  await page.getByText('Tarja enviada à fila de exibição.', {exact: true}).waitFor();
  await page.screenshot({path: directory + '/panel-desktop.png', fullPage: true});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const overlay = await browser.newPage({viewport: {width: 1920, height: 1080}});
  await overlay.goto('http://127.0.0.1:8766/overlay');
  await overlay.getByRole('heading', {name: 'Resumo corrigido no teste de interface'}).waitFor();
  assert.equal(await overlay.getByText('Revisado pela redação', {exact: true}).isVisible(), true);
  assert.equal(await overlay.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await overlay.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgba(0, 0, 0, 0)');
  await overlay.screenshot({path: directory + '/overlay-1920.png', omitBackground: true, animations: 'disabled'});
  await page.getByRole('button', {name: 'Retirar todas as tarjas'}).click();
  await overlay.locator('#card').waitFor({state: 'hidden'});
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({path: directory + '/panel-mobile.png', fullPage: true});
  assert.deepEqual(errors, []);
  console.log('PASS desktop/mobile, login, select, edit, approve, transparent overlay, withdraw, console.');
} finally {
  await browser.close();
}
