const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const extensionConfig = {
  entryPoints: ['./src/extension.ts'],
  bundle: true,
  outfile: './dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
};

async function build() {
  try {
    if (watch) {
      const extCtx = await esbuild.context(extensionConfig);
      await extCtx.watch();
      console.log('Watching for changes...');
    } else {
      await esbuild.build(extensionConfig);
      console.log('Build complete');
    }
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

build();
