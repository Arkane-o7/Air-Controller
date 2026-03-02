const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const mode = (process.argv[2] || 'debug').toLowerCase();
if (!['debug', 'release'].includes(mode)) {
  console.error('[android:apk] Mode must be "debug" or "release".');
  process.exit(1);
}

const webviewDir = path.resolve(__dirname, '..', '..', '..', 'webview');
const isWin = process.platform === 'win32';
const gradlew = isWin ? 'gradlew.bat' : './gradlew';
const task = mode === 'release' ? 'assembleRelease' : 'assembleDebug';

if (!fs.existsSync(path.join(webviewDir, isWin ? 'gradlew.bat' : 'gradlew'))) {
  console.error(`[android:apk] Gradle wrapper not found in ${webviewDir}`);
  process.exit(1);
}

if (!isWin) {
  try {
    fs.chmodSync(path.join(webviewDir, 'gradlew'), 0o755);
  } catch (error) {
    console.warn(`[android:apk] Could not chmod gradlew: ${error.message}`);
  }
}

console.log(`[android:apk] Running ${task} in ${webviewDir}`);
const run = spawnSync(gradlew, [task], {
  cwd: webviewDir,
  stdio: 'inherit',
  shell: isWin
});

if (run.status !== 0) {
  process.exit(run.status || 1);
}

const apkPath = path.join(
  webviewDir,
  'app',
  'build',
  'outputs',
  'apk',
  mode,
  mode === 'release' ? 'app-release.apk' : 'app-debug.apk'
);

console.log(`[android:apk] Done. APK path: ${apkPath}`);
