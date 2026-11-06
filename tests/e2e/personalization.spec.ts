import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'

const artifacts = 'tests/artifacts'
const ready = (page: Page) => page.locator('.avatar-viewer[data-status="ready"]')

function collectConsoleErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  return errors
}

test.beforeAll(async () => { await mkdir(artifacts, { recursive: true }) })

test('generates a local exact-face avatar from a head scan and measurements, then previews and downloads it', async ({ page }) => {
  test.setTimeout(240_000)
  const errors = collectConsoleErrors(page)
  await page.goto('/')
  await expect(ready(page)).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.avatar-viewer')).toHaveAttribute('data-source-kind', 'base')

  await page.getByRole('button', { name: 'Create avatar', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create your own avatar' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Generate exact-face avatar' })).toBeDisabled()

  const photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#7a9b6d' } }).png().toBuffer()
  await dialog.locator('input[type="file"]').first().setInputFiles('public/samples/sample-head-scan.glb')
  await dialog.locator('input[type="file"]').nth(1).setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: photo })
  await dialog.getByLabel('Height in centimeters').fill('175')
  await dialog.getByLabel('Chest in centimeters').fill('100')
  await dialog.getByRole('button', { name: 'Generate exact-face avatar' }).click()

  await expect(dialog.getByText('Face lock verified', { exact: true })).toBeVisible({ timeout: 180_000 })
  await expect(dialog).toContainText('Local face vertex delta:')
  await expect(dialog).toContainText('0 m')
  await expect(dialog).toContainText('sample-head-scan.glb')
  await expect(dialog).toContainText('Stored as reference only; not used for geometry')
  await page.screenshot({ path: `${artifacts}/personalization-success.png`, fullPage: true })
  await dialog.getByRole('button', { name: 'View in studio' }).click()
  await expect(dialog).not.toBeVisible()

  const viewer = page.locator('.avatar-viewer')
  await expect(viewer).toHaveAttribute('data-source-kind', 'custom', { timeout: 60_000 })
  await expect(ready(page)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('My exact-face avatar', { exact: true })).toBeVisible()
  await expect(page.getByText('Face lock verified', { exact: true }).first()).toBeVisible()
  const download = page.getByRole('link', { name: 'Download GLB' })
  await expect(download).toHaveAttribute('href', /^blob:/)
  await expect(download).toHaveAttribute('download', /^personal-avatar-.*\.glb$/)
  const [savedDownload] = await Promise.all([page.waitForEvent('download'), download.click()])
  await savedDownload.saveAs(`${artifacts}/personalized.glb`)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${artifacts}/personalized-desktop.png`, fullPage: true })
  await page.locator('.viewport canvas').screenshot({ path: `${artifacts}/personalized-front.png` })
  expect(errors).toEqual([])

  await page.getByRole('button', { name: 'Use base avatar' }).click()
  await expect(viewer).toHaveAttribute('data-source-kind', 'base')
  await expect(ready(page)).toBeVisible({ timeout: 60_000 })
})

test('rejects a non-glTF scan with an actual error instead of fabricating a face', async ({ page }) => {
  await page.goto('/')
  await expect(ready(page)).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Create avatar', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create your own avatar' })
  await dialog.locator('input[type="file"]').first().setInputFiles({ name: 'face.png', mimeType: 'image/png', buffer: Buffer.from('not a scan') })
  await dialog.getByRole('button', { name: 'Generate exact-face avatar' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Head scan must be a self-contained .glb or .gltf file.')
  await expect(page.locator('.avatar-viewer')).toHaveAttribute('data-source-kind', 'base')
})
