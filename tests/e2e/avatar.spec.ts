import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'

const artifacts = 'tests/artifacts'
const ready = (page: Page) => page.locator('.avatar-viewer[data-status="ready"]')
const canvas = (page: Page) => page.locator('.viewport canvas')

async function settled(page: Page, milliseconds = 950) {
  await page.waitForTimeout(milliseconds)
}

async function pixels(page: Page) {
  const box = await canvas(page).boundingBox()
  if (!box) throw new Error('Canvas has no bounding box')
  // Page-clip capture avoids locator screenshot stability waits on a live WebGL canvas.
  return page.screenshot({ clip: box })
}

async function difference(a: Buffer, b: Buffer) {
  const [left, right] = await Promise.all([a, b].map((buffer) => sharp(buffer).removeAlpha().raw().toBuffer()))
  let changed = 0
  for (let i = 0; i < left.length; i += 3) {
    if (Math.abs(left[i] - right[i]) > 8 || Math.abs(left[i + 1] - right[i + 1]) > 8 || Math.abs(left[i + 2] - right[i + 2]) > 8) changed += 1
  }
  return changed / (left.length / 3)
}

function collectConsoleErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(`${message.type()}: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  return errors
}

test.beforeAll(async () => { await mkdir(artifacts, { recursive: true }) })

test('loads the actual human, decodes every texture, and renders a non-blank full-body studio', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await page.goto('/')
  await expect(ready(page)).toBeVisible({ timeout: 60_000 })
  const viewer = page.locator('.avatar-viewer')
  await expect(viewer).toHaveAttribute('data-textures', '7/7')
  await expect(viewer).toHaveAttribute('data-joints', '67')
  await expect(viewer).toHaveAttribute('data-triangles', '83686')
  await expect(page.getByText('83,686 triangles', { exact: true })).toBeVisible()
  await expect(page.getByText('7 / 7 loaded', { exact: true })).toBeVisible()
  await page.getByText('Model diagnostics', { exact: true }).click()
  await expect(page.getByText(/Head, neck, torso, arms, hands, fingers, legs & feet verified in rig/)).toBeVisible()
  await settled(page, 500)
  const screenshot = await pixels(page)
  const stats = await sharp(screenshot).stats()
  expect(stats.channels[0].stdev).toBeGreaterThan(12)
  await page.screenshot({ path: `${artifacts}/final-desktop.png`, fullPage: true })
  await canvas(page).screenshot({ path: `${artifacts}/front.png` })
  expect(errors).toEqual([])
})

test('front, side, back, zoom, drag, auto-rotation and reset change the real rendered view', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await expect(ready(page)).toBeVisible({ timeout: 60_000 })
  await settled(page)
  // Canvas capture is the stable reference; intermediate page clips keep the test quick.
  const front = await canvas(page).screenshot()

  await page.getByRole('button', { name: 'Side View', exact: true }).click()
  await expect(page.locator('.avatar-viewer')).toHaveAttribute('data-view', 'side')
  await settled(page)
  const side = await pixels(page)
  expect(await difference(front, side)).toBeGreaterThan(0.02)
  await writeFile(`${artifacts}/side.png`, side)

  await page.getByRole('button', { name: 'Back View', exact: true }).click()
  await expect(page.locator('.avatar-viewer')).toHaveAttribute('data-view', 'back')
  await settled(page)
  const back = await pixels(page)
  expect(await difference(side, back)).toBeGreaterThan(0.02)
  await writeFile(`${artifacts}/back.png`, back)

  await page.getByRole('button', { name: 'Zoom In', exact: true }).click()
  await expect.poll(async () => Number(await page.locator('.avatar-viewer').getAttribute('data-zoom'))).toBeGreaterThan(110)
  await settled(page)
  const zoomed = await pixels(page)
  expect(await difference(back, zoomed)).toBeGreaterThan(0.02)
  await page.getByRole('button', { name: 'Zoom Out', exact: true }).click()
  await expect.poll(async () => Number(await page.locator('.avatar-viewer').getAttribute('data-zoom'))).toBe(100)

  await page.getByRole('button', { name: 'Rotate 360°', exact: true }).click()
  await expect(page.locator('.avatar-viewer')).toHaveAttribute('data-rotating', 'true')
  await settled(page, 800)
  const rotating = await pixels(page)
  expect(await difference(zoomed, rotating)).toBeGreaterThan(0.01)
  await page.getByRole('button', { name: 'Stop rotation', exact: true }).click()
  await expect(page.locator('.avatar-viewer')).toHaveAttribute('data-rotating', 'false')

  const box = await canvas(page).boundingBox()
  if (!box) throw new Error('Canvas has no bounding box')
  const beforeDrag = await pixels(page)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2 + 25, { steps: 12 })
  await page.mouse.up()
  await expect(page.locator('.avatar-viewer')).toHaveAttribute('data-view', 'free')
  await settled(page)
  expect(await difference(beforeDrag, await pixels(page))).toBeGreaterThan(0.01)

  await page.getByRole('button', { name: 'Reset View', exact: true }).click()
  await expect(page.locator('.avatar-viewer')).toHaveAttribute('data-view', 'front')
  await expect(page.locator('.avatar-viewer')).toHaveAttribute('data-zoom', '100')
  await settled(page, 1500)
  const resetShot = await canvas(page).screenshot()
  await writeFile(`${artifacts}/reset.png`, resetShot)
  expect(await difference(front, resetShot)).toBeLessThan(0.01)
})

test('shows a real 404 error, disables controls, and recovers through Retry', async ({ page }) => {
  await page.route('**/models/base-avatar.glb', (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Model file missing' }))
  await page.goto('/')
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('HTTP 404')
  await expect(alert).toContainText('/models/base-avatar.glb')
  await expect(page.locator('.avatar-viewer')).toHaveAttribute('data-status', 'error')
  await expect(page.getByRole('button', { name: 'Front View', exact: true })).toBeDisabled()
  await page.screenshot({ path: `${artifacts}/error-404.png`, fullPage: true })
  await page.unroute('**/models/base-avatar.glb')
  await page.getByRole('button', { name: 'Retry loading', exact: true }).click()
  await expect(ready(page)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: 'Front View', exact: true })).toBeEnabled()
})

test('rejects an HTML fallback and a corrupt asset instead of showing a placeholder', async ({ page }) => {
  await page.route('**/models/base-avatar.glb', (route) => route.fulfill({ contentType: 'text/html', body: '<html><body>SPA fallback</body></html>' }))
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('returned HTML')
  await expect(page.locator('.avatar-viewer')).toHaveAttribute('data-status', 'error')
  await page.unroute('**/models/base-avatar.glb')

  await page.route('**/models/base-avatar.glb', (route) => route.fulfill({ contentType: 'model/gltf-binary', body: Buffer.from('corrupt') }))
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('byte length mismatch')
  await expect(page.locator('.avatar-viewer')).toHaveAttribute('data-status', 'error')
})

test('frames the complete avatar on a narrow mobile viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(ready(page)).toBeVisible({ timeout: 60_000 })
  await settled(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByRole('button', { name: 'Back View', exact: true })).toBeVisible()
  await page.screenshot({ path: `${artifacts}/mobile.png`, fullPage: true })
  await page.getByRole('button', { name: 'Side View', exact: true }).click()
  await expect(page.locator('.avatar-viewer')).toHaveAttribute('data-view', 'side')
})

test('exposes the verified source, CC0 license and manifest', async ({ page }) => {
  await page.goto('/')
  await expect(ready(page)).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Asset & license', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('CC0 1.0')
  await expect(dialog.getByRole('link', { name: 'View original source' })).toHaveAttribute('href', /github\.com\/met4citizen\/TalkingHead\/blob\/1563de1/)
  await expect(dialog.getByRole('link', { name: 'Read license' })).toHaveAttribute('href', '/models/CC0-LICENSE.txt')
  await page.screenshot({ path: `${artifacts}/asset-dialog.png`, fullPage: true })
  await page.getByRole('button', { name: 'Close asset details' }).click()
  await expect(dialog).not.toBeVisible()
})
