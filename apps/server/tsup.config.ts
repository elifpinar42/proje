import { defineConfig } from 'tsup';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';

export default defineConfig({
  entry: { standalone: 'src/standalone.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: true,
  noExternal: ['@dr/shared'],
  external: ['node:sqlite'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  onSuccess: async () => {
    // esbuild, tanımadığı `node:sqlite` önekini siler; çıktıda geri ekle.
    const file = 'dist/standalone.js';
    writeFileSync(file, readFileSync(file, 'utf8').replace(/from "sqlite"/g, 'from "node:sqlite"'));
    cpSync('fonts', 'dist/fonts', { recursive: true });
  },
});
