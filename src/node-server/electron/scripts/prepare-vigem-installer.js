const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
const targetDir = path.join(projectRoot, 'electron', 'resources', 'vigem');
const targetFile = path.join(targetDir, 'ViGEmBus_Setup.exe');

const inputFromEnv = process.env.VIGEM_SETUP_PATH ? path.resolve(process.env.VIGEM_SETUP_PATH) : null;

function fail(msg) {
  console.error(`\n[prepare:vigem] ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

if (inputFromEnv) {
  if (!fs.existsSync(inputFromEnv)) {
    fail(`VIGEM_SETUP_PATH does not exist: ${inputFromEnv}`);
  }

  fs.copyFileSync(inputFromEnv, targetFile);
  console.log(`[prepare:vigem] Copied ViGEm installer from ${inputFromEnv}`);
}

if (!fs.existsSync(targetFile)) {
  fail(
    `Missing ViGEm installer.\n` +
    `Place installer at: ${targetFile}\n` +
    `or set VIGEM_SETUP_PATH=<absolute path to ViGEmBus installer exe>.`
  );
}

console.log(`[prepare:vigem] Ready: ${targetFile}`);
