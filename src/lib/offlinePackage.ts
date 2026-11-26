import JSZip from 'jszip';
import { downloadBlob } from './pdfSetup';

type NotifyFn = (type: 'success' | 'error' | 'info', msg: string) => void;

/**
 * Download OfflinePDF-Studio.zip ensuring index.html is verified inside the archive.
 * Falls back to client-side JSZip packaging if the static/dev zip endpoint is unavailable.
 */
export async function downloadOfflineZipPackage(onNotify: NotifyFn): Promise<void> {
  try {
    const res = await fetch('./OfflinePDF-Studio.zip', { cache: 'no-store' });
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      const blob = await res.blob();
      if (blob.size > 1024 && !contentType.includes('text/html')) {
        // Verify index.html exists inside the zip before saving
        const zip = await JSZip.loadAsync(blob);
        if (zip.file('index.html')) {
          downloadBlob(blob, 'OfflinePDF-Studio.zip');
          onNotify('success', 'Downloaded OfflinePDF-Studio.zip (contains index.html + libs/).');
          return;
        }
      }
    }
  } catch {
    // Fall back to client-side zip generation below
  }

  // Fallback: assemble zip client-side with index.html inside
  const zip = new JSZip();
  const htmlDoc = `<!doctype html>\n${document.documentElement.outerHTML}`;
  zip.file('index.html', htmlDoc);

  const libPaths = [
    'libs/pdf.worker.min.mjs',
    'libs/tesseract/worker.min.js',
    'libs/tesseract/tesseract-core-lstm.wasm.js',
    'libs/tesseract/lang/eng.traineddata.gz',
  ];

  for (const relPath of libPaths) {
    try {
      const r = await fetch(`./${relPath}`);
      if (r.ok) {
        zip.file(relPath, await r.arrayBuffer());
      }
    } catch {
      // Skip unavailable optional asset
    }
  }

  const outBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  downloadBlob(outBlob, 'OfflinePDF-Studio.zip');
  onNotify('success', 'Generated & downloaded OfflinePDF-Studio.zip with index.html inside.');
}
