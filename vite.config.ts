import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';
import path from 'path';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      {
        name: 'release-data-proxy',
        configureServer(server) {
          // This middleware runs BEFORE Vite's built-in proxy and static
          // file server. We intercept /release-data/* requests here and
          // fetch from GitHub Releases using Node's fetch() which follows
          // 302 redirects automatically (http-proxy does not).
          server.middlewares.use('/release-data', async (req, res) => {
            const reqUrl = req.url ?? '';
            // reqUrl is the path AFTER /release-data (the mount prefix is stripped)
            // e.g. "/ph-data.zip" or "/sst/sst_t0000.bin"
            const filePath = reqUrl.replace(/^\//, '').split('?')[0];
            const targetUrl = `https://github.com/VMAX-OCEAN/ocean-web/releases/download/data-v1/${filePath}`;

            try {
              const response = await fetch(targetUrl, { redirect: 'follow' });
              if (!response.ok) {
                res.writeHead(response.status, { 'Content-Type': 'text/plain' });
                res.end(`Failed to fetch ${filePath}: HTTP ${response.status}`);
                return;
              }
              // Stream the response body directly to the browser without
              // buffering the entire ZIP in Node.js memory. This prevents
              // the dev server from crashing when multiple 100MB+ ZIPs are
              // requested concurrently.
              const headers: Record<string, string> = {
                'Content-Type': response.headers.get('Content-Type') ?? 'application/octet-stream',
                'Cache-Control': 'public, max-age=86400',
                'Access-Control-Allow-Origin': '*',
              };
              const cl = response.headers.get('Content-Length');
              if (cl) headers['Content-Length'] = cl;
              res.writeHead(response.status, headers);
              // Pipe the ReadableStream body through to the response.
              // Node 18+ supports piping Web ReadableStream to http.ServerResponse.
              const reader = response.body?.getReader();
              if (reader) {
                const pump = async () => {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(Buffer.from(value));
                  }
                  res.end();
                };
                pump().catch((err) => {
                  if (!res.headersSent) {
                    res.writeHead(502, { 'Content-Type': 'text/plain' });
                  }
                  res.end(`Stream error: ${err instanceof Error ? err.message : String(err)}`);
                });
              } else {
                // Fallback: buffer (only for small files or if body is null)
                const body = new Uint8Array(await response.arrayBuffer());
                res.end(Buffer.from(body));
              }
            } catch (err) {
              if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
              }
              res.end(`Proxy error: ${err instanceof Error ? err.message : String(err)}`);
            }
          });
        },
      },
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
        // NOTE: /release-data is handled by the custom plugin above,
        // not the standard proxy (which doesn't follow GitHub's 302 redirects).
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
  };
});
