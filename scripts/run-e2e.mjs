import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import chromium, { inflate, setupLambdaEnvironment } from '@sparticuz/chromium'

// The browser binary and its NSS/NSPR libraries are supplied by npm; no browser CDN is needed.
const executablePath = await chromium.executablePath()
if (process.platform === 'linux') {
  const packageDirectory = dirname(fileURLToPath(import.meta.resolve('@sparticuz/chromium')))
  const libraryDirectory = await inflate(join(packageDirectory, '../bin/al2023.tar.br'))
  setupLambdaEnvironment(join(libraryDirectory, 'lib'))
}
const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: executablePath },
})
process.exit(result.status ?? 1)
