import { defineConfig } from 'tsup';
import { cpSync } from 'node:fs';

export default defineConfig({
  entry: { standalone: 'src/standalone.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: true,
  noExternal: ['@dr/shared'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  onSuccess: async () => {
    cpSync('fonts', 'dist/fonts', { recursive: true });
  },
});
