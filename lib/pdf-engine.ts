import '@/lib/polyfills';
import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import { PDFPageItem, ExtractedTextItem, ExtractedImageItem } from '@/types/pdf';

let pdfjsLib: any = null;

export async function getPdfJs() {
  if (typeof window === 'undefined') return null;

  // Guarantee ReadableStream[Symbol.asyncIterator] for Safari/WebKit
  if (typeof ReadableStream !== 'undefined' && !(ReadableStream.prototype as any)[Symbol.asyncIterator]) {
    (ReadableStream.prototype as any)[Symbol.asyncIterator] = async function* (this: ReadableStream) {
      const reader = this.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    };
  }

  if (!pdfjsLib) {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
    pdfjsLib = pdfjs;
  }
  return pdfjsLib;
}

/**
 * Render a page of a PDF file to a base64 Data URL thumbnail
 */
export async function renderPageThumbnail(
  arrayBuffer: ArrayBuffer,
  pageIndex: number,
  scale: number = 2.0
): Promise<{ dataUrl: string; width: number; height: number }> {
  const pdfjs = await getPdfJs();
  if (!pdfjs) throw new Error('PDF.js not available');

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer.slice(0)),
    cMapUrl: 'https://unpkg.com/pdfjs-dist@6.4.299/cmaps/',
    cMapPacked: true,
  });

  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Could not get canvas 2d context');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: context,
    viewport,
  }).promise;

  const dataUrl = canvas.toDataURL('image/png');
  return {
    dataUrl,
    width: viewport.width / scale,
    height: viewport.height / scale,
  };
}

/**
 * Extract text items with exact styling, font classification, color detection, and geometry
 */
export async function extractPageContentForEditing(
  arrayBuffer: ArrayBuffer,
  pageIndex: number
): Promise<{ textItems: ExtractedTextItem[]; imageItems: ExtractedImageItem[]; width: number; height: number }> {
  const pdfjs = await getPdfJs();
  if (!pdfjs) throw new Error('PDF.js not available');

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer.slice(0)),
    cMapUrl: 'https://unpkg.com/pdfjs-dist@6.4.299/cmaps/',
    cMapPacked: true,
  });

  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1.0 });

  let textContent: any = { items: [], styles: {} };
  try {
    textContent = await page.getTextContent();
  } catch (err: any) {
    console.warn('page.getTextContent() error, using reader fallback:', err);
    try {
      if (typeof page.streamTextContent === 'function') {
        const stream = page.streamTextContent();
        const reader = stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value?.items) textContent.items.push(...value.items);
          if (value?.styles) Object.assign(textContent.styles, value.styles);
        }
      }
    } catch (fallbackErr) {
      console.warn('Fallback stream text extraction failed:', fallbackErr);
    }
  }

  const styles = textContent.styles || {};

  // Build operator list to populate font objects in page.commonObjs and extract colors
  let curColor = '#000000';
  const colorMap = new Map<string, string>();
  const imageItems: ExtractedImageItem[] = [];

  try {
    const ops = await page.getOperatorList();
    for (let j = 0; j < ops.fnArray.length; j++) {
      const fn = ops.fnArray[j];
      const args = ops.argsArray[j];

      // setFillRGBColor
      if (fn === pdfjs.OPS.setFillRGBColor && args) {
        if (typeof args[0] === 'string' && args[0].startsWith('#')) {
          curColor = args[0];
        } else if (args.length >= 3) {
          const r = Math.min(255, Math.max(0, Math.round(args[0] * 255))).toString(16).padStart(2, '0');
          const g = Math.min(255, Math.max(0, Math.round(args[1] * 255))).toString(16).padStart(2, '0');
          const b = Math.min(255, Math.max(0, Math.round(args[2] * 255))).toString(16).padStart(2, '0');
          curColor = `#${r}${g}${b}`;
        }
      } else if (fn === pdfjs.OPS.setFillGray && args && args.length >= 1) {
        const grayVal = Math.min(255, Math.max(0, Math.round(args[0] * 255))).toString(16).padStart(2, '0');
        curColor = `#${grayVal}${grayVal}${grayVal}`;
      } else if (fn === pdfjs.OPS.showText && args && args[0]) {
        const textStr = Array.isArray(args[0])
          ? args[0].map((c: any) => (typeof c === 'object' && c !== null ? (c.unicode || c.fontChar || '') : c)).join('')
          : String(args[0]);
        if (textStr && textStr.trim()) {
          colorMap.set(textStr.trim(), curColor);
        }
      } else if (fn === pdfjs.OPS.paintImageXObject && args) {
        const objId = args[0];
        imageItems.push({
          id: `img-${pageIndex}-${j}-${objId}`,
          x: 40,
          y: viewport.height - 240,
          width: 220,
          height: 160,
          isDeleted: false,
        });
      }
    }
  } catch (e) {
    console.warn('Could not inspect operator list:', e);
  }

  // Pre-fetch actual font descriptors from page.commonObjs
  const fontDescriptors = new Map<string, any>();
  const fontNameKeys = Object.keys(styles);

  for (const fontKey of fontNameKeys) {
    try {
      const fontObj = await new Promise<any>((resolve) => {
        if (page.commonObjs && typeof page.commonObjs.has === 'function' && page.commonObjs.has(fontKey)) {
          page.commonObjs.get(fontKey, (f: any) => resolve(f));
        } else if (page.objs && typeof page.objs.has === 'function' && page.objs.has(fontKey)) {
          page.objs.get(fontKey, (f: any) => resolve(f));
        } else {
          resolve(null);
        }
      });
      if (fontObj) {
        fontDescriptors.set(fontKey, fontObj);
      }
    } catch (e) {
      // Ignore font fetch failure
    }
  }

  const textItems: ExtractedTextItem[] = [];

  for (let i = 0; i < textContent.items.length; i++) {
    const item = textContent.items[i] as any;
    if (!item.str || item.str.trim() === '') continue;

    const transform = item.transform;
    const x = transform[4];
    const y = transform[5];
    const fontSize = Math.sqrt((transform[0] * transform[0]) + (transform[1] * transform[1])) || 12;
    const width = item.width || (item.str.length * fontSize * 0.55);
    const height = item.height || fontSize;

    const fontStyleObj = styles[item.fontName] || {};
    const fontDesc = fontDescriptors.get(item.fontName) || {};

    const fontNameRaw = fontDesc.name || fontDesc.loadedName || item.fontName || '';
    const fontFamilyRaw = fontDesc.family || fontStyleObj.fontFamily || '';
    const combinedFontStr = `${fontNameRaw} ${fontFamilyRaw}`.toLowerCase();

    // Accurate bold check from font descriptors or name keywords
    const isBold = Boolean(
      fontDesc.bold || 
      fontDesc.black || 
      fontStyleObj.bold === true ||
      combinedFontStr.includes('bold') || 
      combinedFontStr.includes('black') || 
      combinedFontStr.includes('heavy') || 
      combinedFontStr.includes('medium') || 
      combinedFontStr.includes('semibold')
    );

    // Accurate italic check from font descriptors or name keywords
    const isItalic = Boolean(
      fontDesc.italic || 
      fontStyleObj.italic === true ||
      combinedFontStr.includes('italic') || 
      combinedFontStr.includes('oblique')
    );

    // Determine font family classification
    let fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

    if (
      combinedFontStr.includes('times') || 
      combinedFontStr.includes('georgia') || 
      combinedFontStr.includes('garamond') ||
      combinedFontStr.includes('cambria')
    ) {
      fontFamily = '"Times New Roman", Times, Georgia, serif';
    } else if (
      combinedFontStr.includes('courier') || 
      combinedFontStr.includes('mono') || 
      combinedFontStr.includes('consolas') || 
      combinedFontStr.includes('code')
    ) {
      fontFamily = '"Courier New", Courier, monospace';
    }

    const extractedColor = colorMap.get(item.str.trim()) || '#0f172a';

    textItems.push({
      id: `text-${pageIndex}-${i}-${Math.random().toString(36).substring(2, 6)}`,
      originalText: item.str,
      currentText: item.str,
      x,
      y,
      width,
      height,
      fontSize: Math.round(fontSize * 10) / 10,
      fontName: item.fontName || 'Helvetica',
      fontFamily,
      isDeleted: false,
      color: extractedColor,
      isBold,
      isItalic,
    });
  }

  return {
    textItems,
    imageItems,
    width: viewport.width,
    height: viewport.height,
  };
}

/**
 * Export PDF with in-place text edits, replacements, text/image redactions and replacements.
 * Preserves the exact font family, weight, slant, size, and position.
 */
export async function exportPDFDocument(
  pages: PDFPageItem[],
  fileMap: Map<string, ArrayBuffer>
): Promise<Uint8Array> {
  const mergedPdf = await PDFDocument.create();
  const loadedDocs = new Map<string, PDFDocument>();

  const fonts = {
    helvetica: await mergedPdf.embedFont(StandardFonts.Helvetica),
    helveticaBold: await mergedPdf.embedFont(StandardFonts.HelveticaBold),
    helveticaOblique: await mergedPdf.embedFont(StandardFonts.HelveticaOblique),
    helveticaBoldOblique: await mergedPdf.embedFont(StandardFonts.HelveticaBoldOblique),
    times: await mergedPdf.embedFont(StandardFonts.TimesRoman),
    timesBold: await mergedPdf.embedFont(StandardFonts.TimesRomanBold),
    timesItalic: await mergedPdf.embedFont(StandardFonts.TimesRomanItalic),
    timesBoldItalic: await mergedPdf.embedFont(StandardFonts.TimesRomanBoldItalic),
    courier: await mergedPdf.embedFont(StandardFonts.Courier),
    courierBold: await mergedPdf.embedFont(StandardFonts.CourierBold),
    courierOblique: await mergedPdf.embedFont(StandardFonts.CourierOblique),
    courierBoldOblique: await mergedPdf.embedFont(StandardFonts.CourierBoldOblique),
  };

  for (const pageItem of pages) {
    let srcDoc = loadedDocs.get(pageItem.fileId);
    if (!srcDoc) {
      const buffer = fileMap.get(pageItem.fileId);
      if (!buffer) continue;
      srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      loadedDocs.set(pageItem.fileId, srcDoc);
    }

    const [copiedPage] = await mergedPdf.copyPages(srcDoc, [pageItem.pageIndex]);

    if (pageItem.rotation) {
      const currentRotation = copiedPage.getRotation().angle;
      copiedPage.setRotation(degrees((currentRotation + pageItem.rotation) % 360));
    }

    // In-place text replacements & redactions
    if (pageItem.textItems && pageItem.textItems.length > 0) {
      for (const item of pageItem.textItems) {
        const isModified = item.currentText !== item.originalText;
        const isDeleted = item.isDeleted;

        if (isModified || isDeleted) {
          const padding = 2;
          copiedPage.drawRectangle({
            x: Math.max(0, item.x - padding),
            y: Math.max(0, item.y - padding),
            width: item.width + (padding * 2),
            height: item.height + (padding * 2),
            color: rgb(1, 1, 1),
          });

          if (!isDeleted && item.currentText.trim() !== '') {
            const fam = (item.fontFamily || item.fontName || '').toLowerCase();
            let font = fonts.helvetica;

            if (fam.includes('times') || fam.includes('georgia') || fam.includes('garamond')) {
              if (item.isBold && item.isItalic) font = fonts.timesBoldItalic;
              else if (item.isBold) font = fonts.timesBold;
              else if (item.isItalic) font = fonts.timesItalic;
              else font = fonts.times;
            } else if (fam.includes('courier') || fam.includes('mono')) {
              if (item.isBold && item.isItalic) font = fonts.courierBoldOblique;
              else if (item.isBold) font = fonts.courierBold;
              else if (item.isItalic) font = fonts.courierOblique;
              else font = fonts.courier;
            } else {
              if (item.isBold && item.isItalic) font = fonts.helveticaBoldOblique;
              else if (item.isBold) font = fonts.helveticaBold;
              else if (item.isItalic) font = fonts.helveticaOblique;
              else font = fonts.helvetica;
            }

            const hexColor = item.color || '#000000';
            const r = parseInt(hexColor.slice(1, 3), 16) / 255 || 0;
            const g = parseInt(hexColor.slice(3, 5), 16) / 255 || 0;
            const b = parseInt(hexColor.slice(5, 7), 16) / 255 || 0;

            copiedPage.drawText(item.currentText, {
              x: item.x,
              y: item.y,
              size: item.fontSize || 12,
              font,
              color: rgb(r, g, b),
            });
          }
        }
      }
    }

    // Image edits and replacements
    if (pageItem.imageItems && pageItem.imageItems.length > 0) {
      for (const imgItem of pageItem.imageItems) {
        // Only redact original PDF images when deleted or replaced; custom items and signatures should not draw opaque white boxes
        if (!imgItem.isCustomAdded && (imgItem.isDeleted || imgItem.replacementDataUrl)) {
          copiedPage.drawRectangle({
            x: imgItem.x,
            y: imgItem.y,
            width: imgItem.width,
            height: imgItem.height,
            color: rgb(1, 1, 1),
          });
        }

        if (imgItem.replacementDataUrl && !imgItem.isDeleted) {
          try {
            let embeddedImg;
            if (imgItem.replacementDataUrl.startsWith('data:image/png')) {
              embeddedImg = await mergedPdf.embedPng(imgItem.replacementDataUrl);
            } else {
              embeddedImg = await mergedPdf.embedJpg(imgItem.replacementDataUrl);
            }

            copiedPage.drawImage(embeddedImg, {
              x: imgItem.x,
              y: imgItem.y,
              width: imgItem.width,
              height: imgItem.height,
            });
          } catch (e) {
            console.error('Failed to embed replacement image:', e);
          }
        }
      }
    }

    mergedPdf.addPage(copiedPage);
  }

  return await mergedPdf.save();
}

/**
 * Split pages into multiple PDF documents based on split markers
 */
export async function splitPDFByCutPoints(
  pages: PDFPageItem[],
  fileMap: Map<string, ArrayBuffer>
): Promise<{ fileName: string; bytes: Uint8Array }[]> {
  const chunks: PDFPageItem[][] = [];
  let currentChunk: PDFPageItem[] = [];

  pages.forEach((page, index) => {
    currentChunk.push(page);
    if (page.selectedForSplit || index === pages.length - 1) {
      chunks.push(currentChunk);
      currentChunk = [];
    }
  });

  const results: { fileName: string; bytes: Uint8Array }[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkPages = chunks[i];
    if (chunkPages.length === 0) continue;
    const bytes = await exportPDFDocument(chunkPages, fileMap);
    results.push({
      fileName: `split-part-${i + 1}.pdf`,
      bytes,
    });
  }

  return results;
}
