import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { imageFileToPngOrJpgBytes, sanitizePdfText } from './pdfSetup';

export interface PptxTextParagraph {
  align: 'left' | 'center' | 'right';
  runs: {
    text: string;
    fontSizePt: number;
    bold: boolean;
    italic: boolean;
    colorHex: string;
  }[];
}

export interface PptxShapeElement {
  type: 'shape';
  xPt: number;
  yPt: number;
  wPt: number;
  hPt: number;
  fillHex?: string;
  strokeHex?: string;
  paragraphs: PptxTextParagraph[];
}

export interface PptxImageElement {
  type: 'image';
  xPt: number;
  yPt: number;
  wPt: number;
  hPt: number;
  dataUrl: string;
}

export type PptxElement = PptxShapeElement | PptxImageElement;

export interface ParsedPptxSlide {
  slideNumber: number;
  widthPt: number;
  heightPt: number;
  bgHex: string;
  elements: PptxElement[];
}

const EMU_PER_PT = 12700;
const emuToPt = (val: string | null | undefined, fallback = 0): number => {
  if (!val) return fallback;
  const n = Number(val);
  return isNaN(n) ? fallback : n / EMU_PER_PT;
};

function resolveZipPath(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const baseParts = baseDir.split('/').filter(Boolean);
  const targetParts = target.split('/');
  for (const part of targetParts) {
    if (part === '..') baseParts.pop();
    else if (part !== '.') baseParts.push(part);
  }
  return baseParts.join('/');
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function getElementsByLocalName(parent: Document | Element, localName: string): Element[] {
  const result: Element[] = [];
  const all = parent.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === localName) {
      result.push(all[i]);
    }
  }
  return result;
}

function findDirectChild(parent: Element, localName: string): Element | null {
  for (let i = 0; i < parent.children.length; i++) {
    if (parent.children[i].localName === localName) return parent.children[i];
  }
  return null;
}

function extractColorHex(el: Element | null): string | undefined {
  if (!el) return undefined;
  const srgb = getElementsByLocalName(el, 'srgbClr')[0];
  if (srgb) {
    const val = srgb.getAttribute('val');
    if (val && /^[0-9a-fA-F]{6}$/.test(val)) return `#${val}`;
  }
  const scheme = getElementsByLocalName(el, 'schemeClr')[0];
  if (scheme) {
    const val = scheme.getAttribute('val');
    const schemeMap: Record<string, string> = {
      tx1: '#111827',
      dk1: '#111827',
      tx2: '#334155',
      dk2: '#1e293b',
      bg1: '#ffffff',
      lt1: '#ffffff',
      bg2: '#f1f5f9',
      lt2: '#f8fafc',
      accent1: '#2563eb',
      accent2: '#0f766e',
      accent3: '#d97706',
    };
    if (val && schemeMap[val]) return schemeMap[val];
  }
  return undefined;
}

export async function parsePptxFile(
  buffer: ArrayBuffer,
  onProgress?: (pct: number) => void
): Promise<ParsedPptxSlide[]> {
  const zip = await JSZip.loadAsync(buffer);
  const parser = new DOMParser();

  const presFile = zip.file('ppt/presentation.xml');
  if (!presFile) {
    throw new Error('Invalid PPTX file: missing ppt/presentation.xml');
  }
  const presXml = parser.parseFromString(await presFile.async('text'), 'application/xml');

  // Slide size in EMUs -> pt (default 16:9 widescreen 960x540 pt)
  const sldSz = getElementsByLocalName(presXml, 'sldSz')[0];
  const slideWidthPt = emuToPt(sldSz?.getAttribute('cx'), 720);
  const slideHeightPt = emuToPt(sldSz?.getAttribute('cy'), 540);

  // Resolve slide order via presentation.xml.rels
  const presRelsFile = zip.file('ppt/_rels/presentation.xml.rels');
  const presRelsMap = new Map<string, string>();
  if (presRelsFile) {
    const relsXml = parser.parseFromString(await presRelsFile.async('text'), 'application/xml');
    for (const rel of getElementsByLocalName(relsXml, 'Relationship')) {
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      if (id && target) {
        presRelsMap.set(id, resolveZipPath('ppt', target));
      }
    }
  }

  const sldIds = getElementsByLocalName(presXml, 'sldId');
  let slidePaths: string[] = [];
  for (const sldId of sldIds) {
    const rId =
      sldId.getAttribute('r:id') ||
      sldId.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    if (rId && presRelsMap.has(rId)) {
      slidePaths.push(presRelsMap.get(rId)!);
    }
  }

  // Fallback if sldIdLst resolution fails
  if (slidePaths.length === 0) {
    slidePaths = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)\.xml/i)?.[1] ?? '0', 10);
        const nb = parseInt(b.match(/slide(\d+)\.xml/i)?.[1] ?? '0', 10);
        return na - nb;
      });
  }

  const slides: ParsedPptxSlide[] = [];

  for (let i = 0; i < slidePaths.length; i++) {
    const slidePath = slidePaths[i];
    const slideFile = zip.file(slidePath);
    if (!slideFile) continue;

    const slideXml = parser.parseFromString(await slideFile.async('text'), 'application/xml');

    // Load slide relationships for embedded images
    const slideFilename = slidePath.split('/').pop()!;
    const relsPath = `ppt/slides/_rels/${slideFilename}.rels`;
    const relsMap = new Map<string, string>();
    const relsFile = zip.file(relsPath);
    if (relsFile) {
      const relsXml = parser.parseFromString(await relsFile.async('text'), 'application/xml');
      for (const rel of getElementsByLocalName(relsXml, 'Relationship')) {
        const id = rel.getAttribute('Id');
        const target = rel.getAttribute('Target');
        if (id && target) {
          relsMap.set(id, resolveZipPath('ppt/slides', target));
        }
      }
    }

    // Background color
    let bgHex = '#ffffff';
    const bgEl = getElementsByLocalName(slideXml, 'bg')[0];
    if (bgEl) {
      const foundBg = extractColorHex(bgEl);
      if (foundBg) bgHex = foundBg;
    }

    const spTree = getElementsByLocalName(slideXml, 'spTree')[0];
    const elements: PptxElement[] = [];

    if (spTree) {
      const children = Array.from(spTree.children);
      for (const node of children) {
        if (node.localName === 'sp') {
          const spPr = findDirectChild(node, 'spPr');
          const xfrm = spPr ? findDirectChild(spPr, 'xfrm') : null;
          const off = xfrm ? findDirectChild(xfrm, 'off') : null;
          const ext = xfrm ? findDirectChild(xfrm, 'ext') : null;

          const xPt = emuToPt(off?.getAttribute('x'), 36);
          const yPt = emuToPt(off?.getAttribute('y'), 36);
          const wPt = emuToPt(ext?.getAttribute('cx'), slideWidthPt - 72);
          const hPt = emuToPt(ext?.getAttribute('cy'), 80);

          const solidFill = spPr ? findDirectChild(spPr, 'solidFill') : null;
          const ln = spPr ? findDirectChild(spPr, 'ln') : null;
          const fillHex = extractColorHex(solidFill);
          const strokeHex = extractColorHex(ln);

          const txBody = findDirectChild(node, 'txBody');
          const paragraphs: PptxTextParagraph[] = [];

          if (txBody) {
            const pEls = Array.from(txBody.children).filter((c) => c.localName === 'p');
            for (const pEl of pEls) {
              const pPr = findDirectChild(pEl, 'pPr');
              const algnAttr = pPr?.getAttribute('algn');
              const align: 'left' | 'center' | 'right' =
                algnAttr === 'ctr' ? 'center' : algnAttr === 'r' ? 'right' : 'left';

              const runs: PptxTextParagraph['runs'] = [];
              for (const child of Array.from(pEl.children)) {
                if (child.localName === 'r' || child.localName === 'fld') {
                  const rPr = findDirectChild(child, 'rPr');
                  const tEl = findDirectChild(child, 't');
                  const txt = tEl?.textContent ?? '';
                  if (!txt) continue;

                  const szRaw = rPr?.getAttribute('sz');
                  const fontSizePt = szRaw ? Math.max(8, Math.min(72, Number(szRaw) / 100)) : 16;
                  const bold = rPr?.getAttribute('b') === '1';
                  const italic = rPr?.getAttribute('i') === '1';
                  const rFill = rPr ? findDirectChild(rPr, 'solidFill') : null;
                  const colorHex = extractColorHex(rFill) ?? '#111827';
                  runs.push({ text: txt, fontSizePt, bold, italic, colorHex });
                }
              }

              if (runs.length > 0) {
                paragraphs.push({ align, runs });
              }
            }
          }

          if (paragraphs.length > 0 || fillHex || strokeHex) {
            elements.push({ type: 'shape', xPt, yPt, wPt, hPt, fillHex, strokeHex, paragraphs });
          }
        } else if (node.localName === 'pic') {
          const spPr = findDirectChild(node, 'spPr');
          const xfrm = spPr ? findDirectChild(spPr, 'xfrm') : null;
          const off = xfrm ? findDirectChild(xfrm, 'off') : null;
          const ext = xfrm ? findDirectChild(xfrm, 'ext') : null;
          const xPt = emuToPt(off?.getAttribute('x'), 40);
          const yPt = emuToPt(off?.getAttribute('y'), 40);
          const wPt = emuToPt(ext?.getAttribute('cx'), 200);
          const hPt = emuToPt(ext?.getAttribute('cy'), 150);

          const blip = getElementsByLocalName(node, 'blip')[0];
          const rId =
            blip?.getAttribute('r:embed') ||
            blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
          if (rId && relsMap.has(rId)) {
            const mediaPath = relsMap.get(rId)!;
            const mediaFile = zip.file(mediaPath);
            if (mediaFile) {
              const bytes = await mediaFile.async('uint8array');
              const extName = mediaPath.split('.').pop()?.toLowerCase() ?? 'png';
              const mime =
                extName === 'jpg' || extName === 'jpeg'
                  ? 'image/jpeg'
                  : extName === 'gif'
                    ? 'image/gif'
                    : extName === 'webp'
                      ? 'image/webp'
                      : 'image/png';
              const dataUrl = `data:${mime};base64,${uint8ToBase64(bytes)}`;
              elements.push({ type: 'image', xPt, yPt, wPt, hPt, dataUrl });
            }
          }
        }
      }
    }

    slides.push({
      slideNumber: i + 1,
      widthPt: slideWidthPt,
      heightPt: slideHeightPt,
      bgHex,
      elements,
    });
    onProgress?.(Math.round(((i + 1) / slidePaths.length) * 100));
  }

  return slides;
}

function hexToRgbValues(hex: string) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b);
}

export async function exportPptxSlidesToPdf(
  slides: ParsedPptxSlide[],
  onProgress?: (pct: number) => void
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const boldItalic = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);

  const pick = (b: boolean, i: boolean) => {
    if (b && i) return boldItalic;
    if (b) return bold;
    if (i) return italic;
    return regular;
  };

  for (let sIdx = 0; sIdx < slides.length; sIdx++) {
    const slide = slides[sIdx];
    const page = pdfDoc.addPage([slide.widthPt, slide.heightPt]);

    page.drawRectangle({
      x: 0,
      y: 0,
      width: slide.widthPt,
      height: slide.heightPt,
      color: hexToRgbValues(slide.bgHex),
    });

    for (const el of slide.elements) {
      if (el.type === 'image') {
        try {
          const { bytes, format } = await imageFileToPngOrJpgBytes(el.dataUrl);
          const embedded = format === 'jpg' ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
          page.drawImage(embedded, {
            x: el.xPt,
            y: slide.heightPt - el.yPt - el.hPt,
            width: Math.max(4, el.wPt),
            height: Math.max(4, el.hPt),
          });
        } catch {
          // Skip unsupported embedded vector/wmf media gracefully
        }
        continue;
      }

      if (el.fillHex || el.strokeHex) {
        page.drawRectangle({
          x: el.xPt,
          y: slide.heightPt - el.yPt - el.hPt,
          width: Math.max(2, el.wPt),
          height: Math.max(2, el.hPt),
          color: el.fillHex ? hexToRgbValues(el.fillHex) : undefined,
          borderColor: el.strokeHex ? hexToRgbValues(el.strokeHex) : undefined,
          borderWidth: el.strokeHex ? 0.8 : 0,
        });
      }

      // Draw paragraphs inside shape box
      const pad = 6;
      const boxWidth = Math.max(24, el.wPt - pad * 2);
      let cursorY = slide.heightPt - el.yPt - pad;

      for (const para of el.paragraphs) {
        const lineRuns = para.runs.map((r) => ({ ...r, text: sanitizePdfText(r.text) }));
        // Word-wrap paragraph cleanly
        const lines: { runs: typeof lineRuns; width: number; maxSz: number }[] = [];
        let curRuns: typeof lineRuns = [];
        let curW = 0;
        let curSz = 12;

        const flush = () => {
          lines.push({ runs: curRuns, width: curW, maxSz: curSz });
          curRuns = [];
          curW = 0;
          curSz = 12;
        };

        for (const r of lineRuns) {
          const f = pick(r.bold, r.italic);
          const tokens = r.text.match(/(\S+|\s+)/g) || [];
          for (const tok of tokens) {
            const w = f.widthOfTextAtSize(tok, r.fontSizePt);
            if (!/^\s+$/.test(tok) && curW + w > boxWidth && curRuns.length > 0) {
              flush();
            }
            if (/^\s+$/.test(tok) && curRuns.length === 0) continue;
            curRuns.push({ ...r, text: tok });
            curW += w;
            curSz = Math.max(curSz, r.fontSizePt);
          }
        }
        if (curRuns.length > 0) flush();

        for (const line of lines) {
          const lineH = line.maxSz * 1.25;
          if (cursorY - lineH < slide.heightPt - el.yPt - el.hPt) break;
          let drawX = el.xPt + pad;
          if (para.align === 'center') drawX = el.xPt + pad + Math.max(0, (boxWidth - line.width) / 2);
          if (para.align === 'right') drawX = el.xPt + pad + Math.max(0, boxWidth - line.width);

          const baseY = cursorY - line.maxSz;
          for (const seg of line.runs) {
            const f = pick(seg.bold, seg.italic);
            page.drawText(seg.text, {
              x: drawX,
              y: baseY,
              size: seg.fontSizePt,
              font: f,
              color: hexToRgbValues(seg.colorHex),
            });
            drawX += f.widthOfTextAtSize(seg.text, seg.fontSizePt);
          }
          cursorY -= lineH;
        }
        cursorY -= 4;
      }
    }

    onProgress?.(Math.round(((sIdx + 1) / slides.length) * 100));
  }

  return await pdfDoc.save();
}
