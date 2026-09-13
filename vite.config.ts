import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      cesium(),
    ],
    base: '/',
    define: {
      'import.meta.env.VITE_CESIUM_ION_TOKEN': JSON.stringify(env.VITE_CESIUM_ION_TOKEN || ''),
      'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL || 'http://localhost:8000'),
      'import.meta.env.VITE_R2_URL': JSON.stringify(env.VITE_R2_URL || ''),
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || ''),
    },
    build: {
      outDir: 'dist',
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': env.VITE_API_URL || 'http://localhost:8000',
        // ERDDAP sends no CORS headers — proxy .png/.csv through same
        // origin in dev. Prod needs ocean-api or host rewrite for /erddap.
        '/erddap': {
          target: 'https://erddap.incois.gov.in',
          changeOrigin: true,
          secure: false,
        },
        // Proxy release-data to GitHub Releases in dev.
        // In production, Vercel rewrites handle this (see vercel.json).
        '/release-data': {
          target: 'https://github.com/VMAX-OCEAN/ocean-web/releases/download/data-v1',
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/release-data/, ''),
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
  };
});
