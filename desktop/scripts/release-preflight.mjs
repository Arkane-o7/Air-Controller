import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const cwd = process.cwd()

const failures = []
const warnings = []

function assert(condition, message) {
  if (!condition) failures.push(message)
}

function warn(condition, message) {
  if (!condition) warnings.push(message)
}

const packageJsonPath = join(cwd, 'package.json')
assert(existsSync(packageJsonPath), 'Missing desktop/package.json')

let packageJson = { version: '0.0.0' }
if (existsSync(packageJsonPath)) {
  packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
}

assert(
  /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(packageJson.version),
  'Package version must be semver-like (e.g. 1.0.0)'
)

const installerHook = join(cwd, 'build', 'installer.nsh')
assert(existsSync(installerHook), 'Missing NSIS installer hook at build/installer.nsh')

const vigemInstallerPath = join(cwd, 'build', 'prereqs', 'ViGEmBus_Setup_x64.exe')
const requireVigemInstaller = process.env.REQUIRE_VIGEM_INSTALLER === '1'
if (requireVigemInstaller) {
  assert(
    existsSync(vigemInstallerPath),
    'Missing required prereq: build/prereqs/ViGEmBus_Setup_x64.exe (set REQUIRE_VIGEM_INSTALLER=0 to bypass)'
  )
} else {
  warn(
    existsSync(vigemInstallerPath),
    'ViGEm installer not found. Windows setup will install app but skip automatic driver setup.'
  )
}

if (warnings.length > 0) {
  console.warn('\nPreflight warnings:')
  for (const warning of warnings) {
    console.warn(`- ${warning}`)
  }
}

if (failures.length > 0) {
  console.error('\nPreflight failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Release preflight passed.')
