import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = `http://localhost:${env.PORT || 3000}`;
  return {
    plugins: [react(), tailwindcss()],
    root: 'frontend',
    publicDir: false,
    build: {
      outDir: '../public',
      emptyOutDir: false,
      assetsDir: 'assets'
    },
    server: {
      host: '0.0.0.0',
      proxy: { '/api': backend, '/auth': backend }
    }
  };
});
