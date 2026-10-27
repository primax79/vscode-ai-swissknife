const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'swk-isolated-home-'));

try {
  const result = spawnSync('npm', ['test'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      HOME: tempHome,
    },
    shell: true,
  });

  process.exit(result.status ?? (result.error ? 1 : 0));
} finally {
  try {
    fs.rmSync(tempHome, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}
