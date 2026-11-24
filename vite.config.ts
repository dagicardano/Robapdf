import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

function addDirToZip(dirPath: string, zipFolder: JSZip | null) {
  if (!zipFolder || !fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      addDirToZip(full, zipFolder.folder(entry.name));
    } else if (entry.isFile()) {
      zipFolder.file(entry.name, fs.readFileSync(full));
    }
  }
}

async function buildOfflineZipBuffer(rootDir: string): Promise<Buffer> {
  const distIndex = path.join(rootDir, 'dist', 'index.html');
  const libsDir = path.join(rootDir, 'public', 'libs');
  const readmePath = path.join(rootDir, 'README.md');

  const zip = new JSZip();
  if (fs.existsSync(distIndex)) {
    const cleanHtml = fs.readFileSync(distIndex, 'utf8').replace('<script type="module" crossorigin>', '<script type="module">');
    zip.file('index.html', cleanHtml);
  } else {
    zip.file('index.html', fs.readFileSync(path.join(rootDir, 'index.html')));
  }
  if (fs.existsSync(readmePath)) {
    zip.file('README.md', fs.readFileSync(readmePath));
  }
  addDirToZip(libsDir, zip.folder('libs'));

  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

export default defineConfig(() => {
  const rootDir = import.meta.dirname;
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      viteSingleFile({ removeViteModuleLoader: true }),
      {
        name: 'offline-html-and-zip-packager',
        transformIndexHtml: {
          order: 'post',
          handler(html) {
            return html.replace('<script type="module" crossorigin>', '<script type="module">');
          },
        },
        configureServer(server) {
          server.middlewares.use('/OfflinePDF-Studio.zip', async (_req, res, next) => {
            try {
              const zipBuf = await buildOfflineZipBuffer(rootDir);
              res.setHeader('Content-Type', 'application/zip');
              res.setHeader('Content-Disposition', 'attachment; filename="OfflinePDF-Studio.zip"');
              res.setHeader('Content-Length', String(zipBuf.length));
              res.end(zipBuf);
            } catch (err) {
              next(err);
            }
          });
        },
        async closeBundle(error?: Error) {
          if (error) return;
          const distDir = path.resolve(rootDir, 'dist');
          const srcAssets = path.resolve(rootDir, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, { recursive: true, force: true });
          }
          if (fs.existsSync(path.join(distDir, 'index.html'))) {
            const zipBuf = await buildOfflineZipBuffer(rootDir);
            fs.writeFileSync(path.join(distDir, 'OfflinePDF-Studio.zip'), zipBuf);
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
