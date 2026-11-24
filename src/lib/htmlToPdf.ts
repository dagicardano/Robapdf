import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { cssColorToRgb, imageFileToPngOrJpgBytes, sanitizePdfText } from './pdfSetup';

export interface HtmlToPdfOptions {
  pageWidthPt: number;
  pageHeightPt: number;
  marginTopPt: number;
  marginRightPt: number;
  marginBottomPt: number;
  marginLeftPt: number;
  backgroundHex?: string;
  baseFontSizePt?: number;
  fontFamily?: 'sans' | 'serif' | 'mono';
  onProgress?: (pct: number) => void;
}

interface TextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontSizePt: number;
  colorStr: string;
}

type AlignType = 'left' | 'center' | 'right';

type ParsedBlock =
  | {
      type: 'paragraph';
      runs: TextRun[];
      align: AlignType;
      spaceBefore: number;
      spaceAfter: number;
      indentPt: number;
      prefix?: string;
      isQuote?: boolean;
    }
  | {
      type: 'hr';
    }
  | {
      type: 'image';
      src: string;
    }
  | {
      type: 'table';
      rows: { cells: { runs: TextRun[]; isHeader: boolean }[] }[];
    };

interface FontSet {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}

function pickFont(fonts: FontSet, bold: boolean, italic: boolean): PDFFont {
  if (bold && italic) return fonts.boldItalic;
  if (bold) return fonts.bold;
  if (italic) return fonts.italic;
  return fonts.regular;
}

function parseFontSizePxOrPt(raw: string | undefined, fallbackPt: number): number {
  if (!raw) return fallbackPt;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.endsWith('pt')) {
    const val = parseFloat(trimmed);
    return isNaN(val) ? fallbackPt : Math.max(7, Math.min(72, val));
  }
  if (trimmed.endsWith('px')) {
    const val = parseFloat(trimmed);
    return isNaN(val) ? fallbackPt : Math.max(7, Math.min(72, val * 0.75));
  }
  // HTML <font size="1..7">
  const map: Record<string, number> = { '1': 8, '2': 10, '3': 12, '4': 14, '5': 18, '6': 24, '7': 32 };
  if (map[trimmed]) return map[trimmed];
  const num = parseFloat(trimmed);
  return isNaN(num) ? fallbackPt : Math.max(7, Math.min(72, num));
}

function collectRuns(
  node: Node,
  inherited: Omit<TextRun, 'text'>,
  out: TextRun[]
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (text.length > 0) {
      out.push({ ...inherited, text });
    }
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === 'br') {
    out.push({ ...inherited, text: '\n' });
    return;
  }

  const next = { ...inherited };
  if (tag === 'b' || tag === 'strong' || el.style.fontWeight === 'bold' || Number(el.style.fontWeight) >= 600) {
    next.bold = true;
  }
  if (tag === 'i' || tag === 'em' || el.style.fontStyle === 'italic') {
    next.italic = true;
  }
  if (tag === 'u' || el.style.textDecoration?.includes('underline')) {
    next.underline = true;
  }
  if (el.style.color) {
    next.colorStr = el.style.color;
  } else if (tag === 'font' && el.getAttribute('color')) {
    next.colorStr = el.getAttribute('color')!;
  }
  if (el.style.fontSize) {
    next.fontSizePt = parseFontSizePxOrPt(el.style.fontSize, next.fontSizePt);
  } else if (tag === 'font' && el.getAttribute('size')) {
    next.fontSizePt = parseFontSizePxOrPt(el.getAttribute('size')!, next.fontSizePt);
  }

  for (const child of Array.from(el.childNodes)) {
    collectRuns(child, next, out);
  }
}

function parseHtmlToBlocks(html: string, baseFontSizePt: number): ParsedBlock[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return [];

  const blocks: ParsedBlock[] = [];
  const defaultStyle: Omit<TextRun, 'text'> = {
    bold: false,
    italic: false,
    underline: false,
    fontSizePt: baseFontSizePt,
    colorStr: '#0f172a',
  };

  const getAlign = (el: HTMLElement): AlignType => {
    const a = (el.style.textAlign || el.getAttribute('align') || 'left').toLowerCase();
    if (a === 'center' || a === 'right') return a;
    return 'left';
  };

  const processElement = (el: HTMLElement, indentPt = 0) => {
    const tag = el.tagName.toLowerCase();

    if (tag === 'hr') {
      blocks.push({ type: 'hr' });
      return;
    }

    if (tag === 'img') {
      const src = el.getAttribute('src');
      if (src) blocks.push({ type: 'image', src });
      return;
    }

    if (tag === 'table') {
      const trs = Array.from(el.querySelectorAll('tr'));
      const rows = trs.map((tr) => {
        const cellEls = Array.from(tr.children).filter(
          (c) => c.tagName.toLowerCase() === 'td' || c.tagName.toLowerCase() === 'th'
        ) as HTMLElement[];
        return {
          cells: cellEls.map((cell) => {
            const isHeader = cell.tagName.toLowerCase() === 'th';
            const runs: TextRun[] = [];
            collectRuns(cell, { ...defaultStyle, bold: isHeader, fontSizePt: Math.max(9, baseFontSizePt - 1) }, runs);
            return { runs, isHeader };
          }),
        };
      });
      if (rows.length > 0) blocks.push({ type: 'table', rows });
      return;
    }

    if (tag === 'ul' || tag === 'ol') {
      let idx = 1;
      for (const child of Array.from(el.children)) {
        const cTag = child.tagName.toLowerCase();
        if (cTag === 'li') {
          const liEl = child as HTMLElement;
          // Check if nested images exist inside li
          const nestedImgs = Array.from(liEl.querySelectorAll('img'));
          const runs: TextRun[] = [];
          collectRuns(liEl, defaultStyle, runs);
          blocks.push({
            type: 'paragraph',
            runs,
            align: getAlign(liEl),
            spaceBefore: 2,
            spaceAfter: 4,
            indentPt: indentPt + 16,
            prefix: tag === 'ol' ? `${idx}. ` : '• ',
          });
          nestedImgs.forEach((img) => {
            const src = img.getAttribute('src');
            if (src) blocks.push({ type: 'image', src });
          });
          idx++;
        }
      }
      return;
    }

    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
      const sizes: Record<string, number> = {
        h1: Math.round(baseFontSizePt * 1.85),
        h2: Math.round(baseFontSizePt * 1.45),
        h3: Math.round(baseFontSizePt * 1.22),
        h4: Math.round(baseFontSizePt * 1.1),
        h5: baseFontSizePt,
        h6: baseFontSizePt,
      };
      const runs: TextRun[] = [];
      collectRuns(el, { ...defaultStyle, bold: true, fontSizePt: sizes[tag] }, runs);
      blocks.push({
        type: 'paragraph',
        runs,
        align: getAlign(el),
        spaceBefore: tag === 'h1' ? 10 : 7,
        spaceAfter: 6,
        indentPt,
      });
      return;
    }

    if (tag === 'blockquote') {
      const runs: TextRun[] = [];
      collectRuns(el, { ...defaultStyle, italic: true, colorStr: '#475569' }, runs);
      blocks.push({
        type: 'paragraph',
        runs,
        align: getAlign(el),
        spaceBefore: 6,
        spaceAfter: 6,
        indentPt: indentPt + 14,
        isQuote: true,
      });
      return;
    }

    if (tag === 'p' || tag === 'div') {
      // If container holds nested block tags directly, recurse into them
      const hasBlockChild = Array.from(el.children).some((c) =>
        ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'hr', 'blockquote'].includes(
          c.tagName.toLowerCase()
        )
      );
      if (hasBlockChild) {
        let inlineBuffer: Node[] = [];
        const flushInline = () => {
          if (inlineBuffer.length === 0) return;
          const runs: TextRun[] = [];
          inlineBuffer.forEach((n) => collectRuns(n, defaultStyle, runs));
          if (runs.some((r) => r.text.trim().length > 0)) {
            blocks.push({
              type: 'paragraph',
              runs,
              align: getAlign(el),
              spaceBefore: 2,
              spaceAfter: 6,
              indentPt,
            });
          }
          inlineBuffer = [];
        };

        for (const child of Array.from(el.childNodes)) {
          if (
            child.nodeType === Node.ELEMENT_NODE &&
            ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'hr', 'blockquote', 'img'].includes(
              (child as HTMLElement).tagName.toLowerCase()
            )
          ) {
            flushInline();
            processElement(child as HTMLElement, indentPt);
          } else {
            inlineBuffer.push(child);
          }
        }
        flushInline();
        return;
      }

      // Extract any inline images separately
      const imgs = Array.from(el.querySelectorAll('img'));
      const runs: TextRun[] = [];
      collectRuns(el, defaultStyle, runs);
      if (runs.length > 0 || imgs.length === 0) {
        blocks.push({
          type: 'paragraph',
          runs: runs.length > 0 ? runs : [{ ...defaultStyle, text: ' ' }],
          align: getAlign(el),
          spaceBefore: 2,
          spaceAfter: 6,
          indentPt,
        });
      }
      imgs.forEach((img) => {
        const src = img.getAttribute('src');
        if (src) blocks.push({ type: 'image', src });
      });
      return;
    }

    // Fallback for any other element
    const runs: TextRun[] = [];
    collectRuns(el, defaultStyle, runs);
    if (runs.length > 0) {
      blocks.push({
        type: 'paragraph',
        runs,
        align: 'left',
        spaceBefore: 2,
        spaceAfter: 5,
        indentPt,
      });
    }
  };

  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const txt = (child.textContent ?? '').trim();
      if (txt.length > 0) {
        blocks.push({
          type: 'paragraph',
          runs: [{ ...defaultStyle, text: txt }],
          align: 'left',
          spaceBefore: 2,
          spaceAfter: 6,
          indentPt: 0,
        });
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      processElement(child as HTMLElement, 0);
    }
  }

  return blocks;
}

interface WrappedSegment {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontSizePt: number;
  colorStr: string;
  width: number;
}

interface WrappedLine {
  segments: WrappedSegment[];
  totalWidth: number;
  maxFontSize: number;
}

function wrapRunsIntoLines(
  runs: TextRun[],
  maxWidth: number,
  fonts: FontSet
): WrappedLine[] {
  const lines: WrappedLine[] = [];
  let currentLine: WrappedSegment[] = [];
  let currentWidth = 0;
  let currentMaxSize = 11;

  const pushLine = () => {
    lines.push({
      segments: currentLine,
      totalWidth: currentWidth,
      maxFontSize: currentMaxSize,
    });
    currentLine = [];
    currentWidth = 0;
    currentMaxSize = 11;
  };

  for (const run of runs) {
    const cleanText = sanitizePdfText(run.text);
    const font = pickFont(fonts, run.bold, run.italic);
    const partsByNewline = cleanText.split('\n');

    for (let pIdx = 0; pIdx < partsByNewline.length; pIdx++) {
      if (pIdx > 0) pushLine();

      const part = partsByNewline[pIdx];
      // Tokenize preserving spaces
      const tokens = part.match(/(\S+|\s+)/g) || [];
      for (const token of tokens) {
        const isSpace = /^\s+$/.test(token);
        const tokenWidth = font.widthOfTextAtSize(token, run.fontSizePt);

        if (!isSpace && currentWidth + tokenWidth > maxWidth && currentLine.length > 0) {
          pushLine();
        }

        // Handle ultra-long single words wider than maxWidth
        if (!isSpace && tokenWidth > maxWidth && currentLine.length === 0) {
          let chunk = '';
          for (const ch of token) {
            const nextW = font.widthOfTextAtSize(chunk + ch, run.fontSizePt);
            if (nextW > maxWidth && chunk.length > 0) {
              currentLine.push({
                text: chunk,
                bold: run.bold,
                italic: run.italic,
                underline: run.underline,
                fontSizePt: run.fontSizePt,
                colorStr: run.colorStr,
                width: font.widthOfTextAtSize(chunk, run.fontSizePt),
              });
              currentMaxSize = Math.max(currentMaxSize, run.fontSizePt);
              currentWidth = font.widthOfTextAtSize(chunk, run.fontSizePt);
              pushLine();
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          if (chunk.length > 0) {
            const w = font.widthOfTextAtSize(chunk, run.fontSizePt);
            currentLine.push({
              text: chunk,
              bold: run.bold,
              italic: run.italic,
              underline: run.underline,
              fontSizePt: run.fontSizePt,
              colorStr: run.colorStr,
              width: w,
            });
            currentWidth += w;
            currentMaxSize = Math.max(currentMaxSize, run.fontSizePt);
          }
          continue;
        }

        if (isSpace && currentLine.length === 0) {
          continue; // skip leading whitespace on wrapped lines
        }

        currentLine.push({
          text: token,
          bold: run.bold,
          italic: run.italic,
          underline: run.underline,
          fontSizePt: run.fontSizePt,
          colorStr: run.colorStr,
          width: tokenWidth,
        });
        currentWidth += tokenWidth;
        currentMaxSize = Math.max(currentMaxSize, run.fontSizePt);
      }
    }
  }

  if (currentLine.length > 0 || lines.length === 0) {
    pushLine();
  }

  return lines;
}

export async function renderHtmlToPdfBytes(html: string, opts: HtmlToPdfOptions): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const family = opts.fontFamily ?? 'sans';

  const fonts: FontSet =
    family === 'serif'
      ? {
          regular: await pdfDoc.embedFont(StandardFonts.TimesRoman),
          bold: await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
          italic: await pdfDoc.embedFont(StandardFonts.TimesRomanItalic),
          boldItalic: await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic),
        }
      : family === 'mono'
        ? {
            regular: await pdfDoc.embedFont(StandardFonts.Courier),
            bold: await pdfDoc.embedFont(StandardFonts.CourierBold),
            italic: await pdfDoc.embedFont(StandardFonts.CourierOblique),
            boldItalic: await pdfDoc.embedFont(StandardFonts.CourierBoldOblique),
          }
        : {
            regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
            bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
            italic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
            boldItalic: await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique),
          };

  const bgRgb = opts.backgroundHex ? cssColorToRgb(opts.backgroundHex, '#ffffff') : rgb(1, 1, 1);
  const contentWidth = Math.max(60, opts.pageWidthPt - opts.marginLeftPt - opts.marginRightPt);

  const createStyledPage = (): PDFPage => {
    const p = pdfDoc.addPage([opts.pageWidthPt, opts.pageHeightPt]);
    if (opts.backgroundHex && opts.backgroundHex.toLowerCase() !== '#ffffff') {
      p.drawRectangle({
        x: 0,
        y: 0,
        width: opts.pageWidthPt,
        height: opts.pageHeightPt,
        color: bgRgb,
      });
    }
    return p;
  };

  let page = createStyledPage();
  let cursorY = opts.pageHeightPt - opts.marginTopPt;

  const ensureSpace = (neededPt: number) => {
    if (cursorY - neededPt < opts.marginBottomPt) {
      page = createStyledPage();
      cursorY = opts.pageHeightPt - opts.marginTopPt;
    }
  };

  const blocks = parseHtmlToBlocks(html, opts.baseFontSizePt ?? 12);
  const totalBlocks = Math.max(1, blocks.length);

  for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
    const block = blocks[bIdx];
    opts.onProgress?.(Math.round(((bIdx + 1) / totalBlocks) * 90));

    if (block.type === 'hr') {
      ensureSpace(16);
      cursorY -= 6;
      page.drawLine({
        start: { x: opts.marginLeftPt, y: cursorY },
        end: { x: opts.pageWidthPt - opts.marginRightPt, y: cursorY },
        thickness: 0.75,
        color: rgb(0.8, 0.84, 0.88),
      });
      cursorY -= 10;
      continue;
    }

    if (block.type === 'image') {
      try {
        const { bytes, format, width, height } = await imageFileToPngOrJpgBytes(block.src);
        const embedded = format === 'jpg' ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
        const maxImgW = contentWidth;
        const maxImgH = opts.pageHeightPt - opts.marginTopPt - opts.marginBottomPt - 10;
        let drawW = width * 0.75;
        let drawH = height * 0.75;
        const scaleW = maxImgW / drawW;
        const scaleH = maxImgH / drawH;
        const scale = Math.min(1, scaleW, scaleH);
        drawW *= scale;
        drawH *= scale;

        ensureSpace(drawH + 10);
        page.drawImage(embedded, {
          x: opts.marginLeftPt,
          y: cursorY - drawH,
          width: drawW,
          height: drawH,
        });
        cursorY -= drawH + 10;
      } catch {
        // Ignore broken inline image gracefully
      }
      continue;
    }

    if (block.type === 'table') {
      cursorY -= 4;
      const cellPad = 5;
      for (const row of block.rows) {
        const colCount = Math.max(1, row.cells.length);
        const colW = contentWidth / colCount;
        const wrappedCells = row.cells.map((c) => wrapRunsIntoLines(c.runs, colW - cellPad * 2, fonts));
        const maxLines = Math.max(1, ...wrappedCells.map((lines) => lines.length));
        const rowH = maxLines * 14 + cellPad * 2;

        ensureSpace(rowH + 2);
        const rowTop = cursorY;

        for (let cIdx = 0; cIdx < row.cells.length; cIdx++) {
          const cellX = opts.marginLeftPt + cIdx * colW;
          page.drawRectangle({
            x: cellX,
            y: rowTop - rowH,
            width: colW,
            height: rowH,
            color: row.cells[cIdx].isHeader ? rgb(0.94, 0.96, 0.98) : undefined,
            borderColor: rgb(0.78, 0.82, 0.87),
            borderWidth: 0.6,
          });

          const cellLines = wrappedCells[cIdx];
          let lineY = rowTop - cellPad - 10;
          for (const line of cellLines) {
            let drawX = cellX + cellPad;
            for (const seg of line.segments) {
              const segFont = pickFont(fonts, seg.bold, seg.italic);
              page.drawText(seg.text, {
                x: drawX,
                y: lineY,
                size: seg.fontSizePt,
                font: segFont,
                color: cssColorToRgb(seg.colorStr),
              });
              drawX += seg.width;
            }
            lineY -= 14;
          }
        }
        cursorY -= rowH;
      }
      cursorY -= 8;
      continue;
    }

    // Paragraph / Heading / List Item / Blockquote
    cursorY -= block.spaceBefore;
    const availW = Math.max(40, contentWidth - block.indentPt);
    const lines = wrapRunsIntoLines(block.runs, availW, fonts);
    const quoteStartY = cursorY;

    for (let lIdx = 0; lIdx < lines.length; lIdx++) {
      const line = lines[lIdx];
      const lineH = Math.max(14, line.maxFontSize * 1.38);
      ensureSpace(lineH);

      const baseX = opts.marginLeftPt + block.indentPt;
      let startX = baseX;
      if (block.align === 'center') {
        startX = baseX + Math.max(0, (availW - line.totalWidth) / 2);
      } else if (block.align === 'right') {
        startX = baseX + Math.max(0, availW - line.totalWidth);
      }

      const baselineY = cursorY - line.maxFontSize;

      if (lIdx === 0 && block.prefix) {
        const prefixText = sanitizePdfText(block.prefix);
        page.drawText(prefixText, {
          x: opts.marginLeftPt + Math.max(0, block.indentPt - 14),
          y: baselineY,
          size: line.maxFontSize,
          font: fonts.bold,
          color: rgb(0.15, 0.2, 0.3),
        });
      }

      if (block.isQuote) {
        page.drawLine({
          start: { x: opts.marginLeftPt + 4, y: cursorY },
          end: { x: opts.marginLeftPt + 4, y: cursorY - lineH },
          thickness: 2,
          color: rgb(0.58, 0.64, 0.72),
        });
      }

      let x = startX;
      for (const seg of line.segments) {
        const segFont = pickFont(fonts, seg.bold, seg.italic);
        const segColor = cssColorToRgb(seg.colorStr);
        page.drawText(seg.text, {
          x,
          y: baselineY,
          size: seg.fontSizePt,
          font: segFont,
          color: segColor,
        });
        if (seg.underline && seg.text.trim().length > 0) {
          page.drawLine({
            start: { x, y: baselineY - 1.5 },
            end: { x: x + seg.width, y: baselineY - 1.5 },
            thickness: Math.max(0.6, seg.fontSizePt * 0.06),
            color: segColor,
          });
        }
        x += seg.width;
      }

      cursorY -= lineH;
    }

    if (block.isQuote && quoteStartY > cursorY) {
      // Visual polish handled per-line across page breaks
    }
    cursorY -= block.spaceAfter;
  }

  opts.onProgress?.(100);
  return await pdfDoc.save();
}
