import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const shared = resolve(__dirname, '../../packages/shared/src/index.ts');
const server = resolve(__dirname, '../server/src/index.ts');

export default defineConfig({
  main: {
    // Çalışma anında gereken paketler (express, pdfkit …) dışarıda bırakılır;
    // yalnızca çalışma alanı kaynakları (@dr/*) pakete gömülür.
    plugins: [externalizeDepsPlugin({ exclude: ['@dr/shared', '@dr/server'] })],
    resolve: { alias: { '@dr/shared': shared, '@dr/server': server } },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@dr/shared'] })],
    resolve: { alias: { '@dr/shared': shared } },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: { alias: { '@dr/shared': shared } },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } },
  },
});
