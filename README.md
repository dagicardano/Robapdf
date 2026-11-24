# OfflinePDF Studio

**100% Offline — No data leaves your device.**

OfflinePDF Studio is a complete client-side PDF workstation built to operate without an internet connection, external CDNs, remote APIs, or telemetry.

## Vendored Local Libraries (`/public/libs/` & `node_modules`)

All runtime dependencies are bundled locally:

| Library / Asset | Local Path / Package | Purpose |
|---|---|---|
| `pdf-lib` | Bundled via npm (`pdf-lib`) | PDF creation, merging, splitting, annotations, page scaling |
| `pdfjs-dist` | Bundled + `/public/libs/pdf.worker.min.mjs` | High-DPI client-side PDF rendering & thumbnail previews |
| `jszip` | Bundled via npm (`jszip`) | Unzipping `.pptx` archives & bundling multi-file PDF exports |
| `mammoth` | Bundled via npm (`mammoth`) | Parsing `.docx` documents & embedded images to HTML |
| `tesseract.js` | Bundled + `/public/libs/tesseract/` | Local WebAssembly OCR (`worker.min.js`, `tesseract-core*.wasm`) |
| `@tesseract.js-data/eng` | `/public/libs/tesseract/lang/eng.traineddata.gz` | Offline English OCR trained language data |
| Fonts | `@fontsource/plus-jakarta-sans`, `@fontsource/jetbrains-mono` | Locally bundled UI & monospace fonts |

## Building & Downloading the Offline `.zip` Package

```bash
npm install
npm run package:zip
```

This compiles a self-contained single-file `index.html` (all JS, CSS, and fonts inlined via `vite-plugin-singlefile`) and packages it alongside `./libs/` and `README.md` into `OfflinePDF-Studio.zip`. You can also click **Download Offline .zip** directly inside the app sidebar.
