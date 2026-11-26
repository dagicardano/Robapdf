import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

const rootDir = path.resolve(import.meta.dirname, '..');
const distIndex = path.join(rootDir, 'dist', 'index.html');
const libsDir = path.join(rootDir, 'public', 'libs');
const readmePath = path.join(rootDir, 'README.md');

if (!fs.existsSync(distIndex)) {
  console.error('dist/index.html not found. Run npm run build first.');
  process.exit(1);
}

const zip = new JSZip();

// Add single-file self-contained index.html at zip root
zip.file('index.html', fs.readFileSync(distIndex));

if (fs.existsSync(readmePath)) {
  zip.file('README.md', fs.readFileSync(readmePath));
}

// Recursively add ./libs/ (PDF.js worker & Tesseract WASM + English traineddata)
function addDirToZip(dirPath, zipFolder) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      addDirToZip(full, zipFolder.folder(entry.name));
    } else if (entry.isFile()) {
      zipFolder.file(entry.name, fs.readFileSync(full));
    }
  }
}

if (fs.existsSync(libsDir)) {
  addDirToZip(libsDir, zip.folder('libs'));
}

const buffer = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 6 },
});

const outRoot = path.join(rootDir, 'OfflinePDF-Studio.zip');
const outPublic = path.join(rootDir, 'public', 'OfflinePDF-Studio.zip');

fs.writeFileSync(outRoot, buffer);
fs.writeFileSync(outPublic, buffer);

console.log(`Created OfflinePDF-Studio.zip (${(buffer.length / (1024 * 1024)).toFixed(2)} MB) with index.html inside.`);
