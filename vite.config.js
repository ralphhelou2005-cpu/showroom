import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: '/showroom/',
  publicDir: false,
  plugins: [{
    name: 'copy-showroom-photos',
    closeBundle() {
      const output = resolve(root, 'dist', 'assets');
      mkdirSync(output, { recursive: true });
      cpSync(resolve(root, 'assets', 'photos'), resolve(output, 'photos'), { recursive: true });
      cpSync(resolve(root, 'assets', 'logo'), resolve(output, 'logo'), { recursive: true });
      cpSync(resolve(root, 'assets', 'reference'), resolve(output, 'reference'), { recursive: true });
      cpSync(resolve(root, 'assets', 'materials'), resolve(output, 'materials'), { recursive: true });
      cpSync(resolve(root, 'assets', 'environment'), resolve(output, 'environment'), { recursive: true });
      cpSync(resolve(root, 'video-story'), resolve(root, 'dist', 'video-story'), { recursive: true });
      cpSync(resolve(root, 'sw.js'), resolve(root, 'dist', 'sw.js'));
    },
  }],
});