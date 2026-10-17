import '@/lib/polyfills';
import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import { PDFPageItem, ExtractedTextItem, ExtractedImageItem } from '@/types/pdf';

let pdfjsLib: any = null;

const PDFJS_CMAP_URL = 'https://unpkg.com/pdfjs-dist@6.4.299/cmaps/';
const PDFJS_STANDARD_FONTS_URL = 'https://unpkg.com/pdfjs-dist@6.4.299/standard_fonts/';

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
    // Use legacy build which includes core-js polyfills for Math.sumPrecise, Map.getOrInsertComputed, and Uint8Array.toBase64
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
    pdfjsLib = pdfjs;
  }
  return pdfjsLib;
}

/**
 * Inspect OpenType / TrueType binary font tables (OS/2, head, post, name)
 * to extract exact weight, italic, serif, monospace, and family names even when PDF font names are subsetted or obfuscated.
 */
function inspectOpenTypeFontData(data?: Uint8Array): {
  isBold: boolean;
  isItalic: boolean;
  isSerif: boolean;
  isMonospace: boolean;
  weight: number;
  names: Record<number, string>;
} | null {
  if (!data || data.byteLength < 12) return null;
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const numTables = view.getUint16(4, false);
    if (numTables <= 0 || numTables > 120) return null;

    let isBold = false;
    let isItalic = false;
    let isSerif = false;
    let isMonospace = false;
    let weight = 400;
    const names: Record<number, string> = {};

    for (let i = 0; i < numTables; i++) {
      const eo = 12 + i * 16;
      if (eo + 16 > data.byteLength) break;
      const tag = String.fromCharCode(data[eo], data[eo + 1], data[eo + 2], data[eo + 3]);
      const offset = view.getUint32(eo + 8, false);
      const length = view.getUint32(eo + 12, false);
      if (offset + length > data.byteLength) continue;

      if (tag === 'OS/2' && length >= 6) {
        const usWeightClass = view.getUint16(offset + 4, false);
        if (usWeightClass >= 100 && usWeightClass <= 1000) {
          weight = usWeightClass;
          if (usWeightClass >= 600) isBold = true;
        }
        if (length >= 42) {
          const panoseSerif = data[offset + 33];
          const panoseWeight = data[offset + 34];
          const panoseProp = data[offset + 35];
          if (panoseSerif >= 2 && panoseSerif <= 10) isSerif = true;
          if (panoseWeight >= 7) isBold = true;
          if (panoseProp === 9) isMonospace = true;
        }
        if (length >= 64) {
          const fsSelection = view.getUint16(offset + 62, false);
          if ((fsSelection & 0x20) !== 0) isBold = true;
          if ((fsSelection & 0x01) !== 0 || (fsSelection & 0x200) !== 0) isItalic = true;
        }
      } else if (tag === 'head' && length >= 46) {
        const macStyle = view.getUint16(offset + 44, false);
        if ((macStyle & 0x01) !== 0) isBold = true;
        if ((macStyle & 0x02) !== 0) isItalic = true;
      } else if (tag === 'post' && length >= 16) {
        const italicAngle = view.getInt32(offset + 4, false);
        const isFixedPitch = view.getUint32(offset + 12, false);
        if (italicAngle !== 0) isItalic = true;
        if (isFixedPitch !== 0) isMonospace = true;
      } else if (tag === 'name' && length >= 6) {
        const count = view.getUint16(offset + 2, false);
        const strOffset = view.getUint16(offset + 4, false);
        for (let j = 0; j < count; j++) {
          const ro = offset + 6 + j * 12;
          if (ro + 12 > offset + length) break;
          const platformID = view.getUint16(ro, false);
          const nameID = view.getUint16(ro + 6, false);
          const strLen = view.getUint16(ro + 8, false);
          const strPos = offset + strOffset + view.getUint16(ro + 10, false);
          if (strPos + strLen > offset + length) continue;

          if (platformID === 1 && (nameID === 1 || nameID === 2 || nameID === 4 || nameID === 6)) {
            let s = '';
            for (let k = 0; k < strLen; k++) {
              const ch = data[strPos + k];
              if (ch >= 32 && ch <= 126) s += String.fromCharCode(ch);
            }
            if (s && !names[nameID]) names[nameID] = s;
          } else if (platformID === 3 && (nameID === 1 || nameID === 2 || nameID === 4 || nameID === 6)) {
            let s = '';
            for (let k = 0; k + 1 < strLen; k += 2) {
              const ch = view.getUint16(strPos + k, false);
              if (ch >= 32 && ch <= 126) s += String.fromCharCode(ch);
            }
            if (s) names[nameID] = s;
          }
        }
      }
    }
    return { isBold, isItalic, isSerif, isMonospace, weight, names };
  } catch {
    return null;
  }
}

/**
 * Resolve a PDF.js font object from page.commonObjs or page.objs.
 * In browsers, PDF.js binds FontFace asynchronously before resolving commonObjs,
 * so we must await the callback even if .has(fontKey) is initially false.
 */
async function resolvePdfFontObject(page: any, fontKey: string): Promise<any> {
  if (!fontKey) return null;
  try {
    if (page.commonObjs && typeof page.commonObjs.has === 'function' && page.commonObjs.has(fontKey)) {
      return page.commonObjs.get(fontKey);
    }
    if (page.objs && typeof page.objs.has === 'function' && page.objs.has(fontKey)) {
      return page.objs.get(fontKey);
    }
  } catch {
    // Fall through to async callback resolution
  }

  return new Promise<any>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          if (page.commonObjs?.has?.(fontKey)) {
            resolve(page.commonObjs.get(fontKey));
            return;
          }
          if (page.objs?.has?.(fontKey)) {
            resolve(page.objs.get(fontKey));
            return;
          }
        } catch {}
        resolve(null);
      }
    }, 1200);

    try {
      const pool = fontKey.startsWith('g_') ? page.commonObjs : (page.commonObjs || page.objs);
      if (pool && typeof pool.get === 'function') {
        pool.get(fontKey, (fontObj: any) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(fontObj || null);
          }
        });
      } else {
        clearTimeout(timer);
        resolve(null);
      }
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    }
  });
}

/**
 * Map a raw PDF font string and style flags to an accurate, metric-compatible CSS font-family stack.
 */
export function resolveMatchingFontStack(
  combinedFontStr: string,
  cleanFamilyName: string,
  isSerif: boolean,
  isMonospace: boolean
): string {
  const s = combinedFontStr.toLowerCase();

  // Monospace families
  if (
    isMonospace ||
    s.includes('courier') ||
    s.includes('cousine') ||
    s.includes('consolas') ||
    s.includes('menlo') ||
    s.includes('monaco') ||
    s.includes('mono') ||
    s.includes('fira code') ||
    s.includes('firacode') ||
    s.includes('jetbrains') ||
    s.includes('lucida console') ||
    s.includes('inconsolata') ||
    s.includes('source code') ||
    s.includes('cmtt')
  ) {
    if (s.includes('consolas') || s.includes('menlo') || s.includes('monaco')) {
      return 'Consolas, Menlo, Monaco, "Cousine", "Courier New", monospace';
    }
    return '"Courier New", "Cousine", Courier, Consolas, Menlo, monospace';
  }

  // Specific Sans-Serif & Serif document families
  if (s.includes('calibri') || s.includes('carlito')) {
    return 'Calibri, "Carlito", "Segoe UI", "Arimo", Arial, sans-serif';
  }
  if (s.includes('cambria') || s.includes('caladea')) {
    return 'Cambria, "Caladea", Georgia, "Tinos", "Times New Roman", serif';
  }
  if (s.includes('garamond') || s.includes('baskerville') || s.includes('caslon') || s.includes('minion')) {
    return '"EB Garamond", Garamond, Baskerville, "Times New Roman", Georgia, serif';
  }
  if (s.includes('georgia') || s.includes('merriweather') || s.includes('lora') || s.includes('playfair')) {
    return 'Georgia, "Merriweather", "Times New Roman", Times, serif';
  }
  if (s.includes('palatino') || s.includes('book antiqua') || s.includes('bookantiqua') || s.includes('palladio')) {
    return '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
  }
  if (
    s.includes('times') ||
    s.includes('tinos') ||
    s.includes('nimbusrom') ||
    s.includes('liberationserif') ||
    s.includes('liberation serif') ||
    s.includes('cmr') ||
    s.includes('cmbx') ||
    s.includes('cmti')
  ) {
    return '"Times New Roman", "Tinos", Times, Georgia, serif';
  }
  if (s.includes('roboto')) {
    return '"Roboto", "Arimo", "Helvetica Neue", Arial, sans-serif';
  }
  if (s.includes('inter')) {
    return '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif';
  }
  if (s.includes('open sans') || s.includes('opensans')) {
    return '"Open Sans", "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif';
  }
  if (s.includes('lato')) {
    return '"Lato", "Helvetica Neue", Arial, sans-serif';
  }
  if (
    s.includes('montserrat') ||
    s.includes('poppins') ||
    s.includes('raleway') ||
    s.includes('century gothic') ||
    s.includes('centurygothic') ||
    s.includes('futura') ||
    s.includes('avant garde')
  ) {
    if (s.includes('poppins')) {
      return '"Poppins", "Montserrat", "Helvetica Neue", Arial, sans-serif';
    }
    return '"Montserrat", "Poppins", "Century Gothic", Futura, "Helvetica Neue", Arial, sans-serif';
  }
  if (s.includes('segoe') || s.includes('tahoma') || s.includes('verdana') || s.includes('trebuchet')) {
    if (s.includes('verdana')) {
      return 'Verdana, "Segoe UI", Tahoma, Arial, sans-serif';
    }
    if (s.includes('tahoma')) {
      return 'Tahoma, "Segoe UI", Verdana, Arial, sans-serif';
    }
    if (s.includes('trebuchet')) {
      return '"Trebuchet MS", "Segoe UI", Arial, sans-serif';
    }
    return '"Segoe UI", Tahoma, "Roboto", "Helvetica Neue", Arial, sans-serif';
  }
  if (s.includes('arial') || s.includes('arimo') || s.includes('liberationsans') || s.includes('liberation sans')) {
    return 'Arial, "Arimo", "Helvetica Neue", Helvetica, sans-serif';
  }
  if (s.includes('helvetica') || s.includes('nimbussan') || s.includes('swiss')) {
    return '"Helvetica Neue", Helvetica, Arial, "Arimo", sans-serif';
  }

  // If we extracted a valid custom family name from OpenType table or PDF descriptor, prepend it
  const customPrefix =
    cleanFamilyName &&
    cleanFamilyName.length > 2 &&
    !/^(g_d\d+|f\d+|font\d+|cidfont|unknown|default|sans|serif|mono)/i.test(cleanFamilyName)
      ? `"${cleanFamilyName.replace(/"/g, '')}", `
      : '';

  if (isSerif) {
    return `${customPrefix}"Times New Roman", "Tinos", Times, Georgia, serif`;
  }

  return `${customPrefix}Arial, "Arimo", "Helvetica Neue", Helvetica, "Roboto", "Segoe UI", sans-serif`;
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
    cMapUrl: PDFJS_CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: PDFJS_STANDARD_FONTS_URL,
    fontExtraProperties: true,
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
    cMapUrl: PDFJS_CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: PDFJS_STANDARD_FONTS_URL,
    fontExtraProperties: true,
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

  // Build operator list to populate font objects in page.commonObjs and extract colors & synthetic bold (Tr = 2)
  let curColor = '#000000';
  let curTextRenderingMode = 0;
  const colorMap = new Map<string, string>();
  const fauxBoldSet = new Set<string>();
  const fontKeysFromOps = new Set<string>();
  const imageItems: ExtractedImageItem[] = [];

  try {
    const ops = await page.getOperatorList();
    for (let j = 0; j < ops.fnArray.length; j++) {
      const fn = ops.fnArray[j];
      const args = ops.argsArray[j];

      if (fn === pdfjs.OPS.setFont && args && typeof args[0] === 'string') {
        fontKeysFromOps.add(args[0]);
      } else if (fn === pdfjs.OPS.setTextRenderingMode && args && typeof args[0] === 'number') {
        curTextRenderingMode = args[0];
      } else if (fn === pdfjs.OPS.setFillRGBColor && args) {
        if (typeof args[0] === 'string' && args[0].startsWith('#')) {
          curColor = args[0];
        } else if (args.length >= 3) {
          const scale = args[0] > 1 || args[1] > 1 || args[2] > 1 ? 1 : 255;
          const r = Math.min(255, Math.max(0, Math.round(args[0] * scale))).toString(16).padStart(2, '0');
          const g = Math.min(255, Math.max(0, Math.round(args[1] * scale))).toString(16).padStart(2, '0');
          const b = Math.min(255, Math.max(0, Math.round(args[2] * scale))).toString(16).padStart(2, '0');
          curColor = `#${r}${g}${b}`;
        }
      } else if (fn === pdfjs.OPS.setFillGray && args && args.length >= 1) {
        const grayVal = Math.min(255, Math.max(0, Math.round(args[0] * 255))).toString(16).padStart(2, '0');
        curColor = `#${grayVal}${grayVal}${grayVal}`;
      } else if (fn === pdfjs.OPS.setFillCMYKColor && args && args.length >= 4) {
        const [c, m, y, k] = args;
        const r = Math.min(255, Math.max(0, Math.round(255 * (1 - c) * (1 - k)))).toString(16).padStart(2, '0');
        const g = Math.min(255, Math.max(0, Math.round(255 * (1 - m) * (1 - k)))).toString(16).padStart(2, '0');
        const b = Math.min(255, Math.max(0, Math.round(255 * (1 - y) * (1 - k)))).toString(16).padStart(2, '0');
        curColor = `#${r}${g}${b}`;
      } else if (fn === pdfjs.OPS.showText && args && args[0]) {
        const textStr = Array.isArray(args[0])
          ? args[0].map((c: any) => (typeof c === 'object' && c !== null ? (c.unicode || c.fontChar || '') : c)).join('')
          : String(args[0]);
        const trimmed = textStr ? textStr.trim() : '';
        if (trimmed) {
          colorMap.set(trimmed, curColor);
          if (curTextRenderingMode === 2 || curTextRenderingMode === 6) {
            fauxBoldSet.add(trimmed);
          }
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

  // Collect all unique font keys from styles, items, and operator list
  const allFontKeys = new Set<string>([
    ...Object.keys(styles),
    ...Array.from(fontKeysFromOps),
    ...textContent.items.map((it: any) => it?.fontName).filter(Boolean),
  ]);

  // Pre-fetch actual font descriptors from page.commonObjs / page.objs in parallel
  const fontDescriptors = new Map<string, any>();
  const openTypeMetadata = new Map<string, ReturnType<typeof inspectOpenTypeFontData>>();

  await Promise.all(
    Array.from(allFontKeys).map(async (fontKey) => {
      const fontObj = await resolvePdfFontObject(page, fontKey);
      if (fontObj) {
        fontDescriptors.set(fontKey, fontObj);
        if (fontObj.data instanceof Uint8Array) {
          const otInfo = inspectOpenTypeFontData(fontObj.data);
          if (otInfo) {
            openTypeMetadata.set(fontKey, otInfo);
          }
        }
      }
    })
  );

  const textItems: ExtractedTextItem[] = [];

  for (let i = 0; i < textContent.items.length; i++) {
    const item = textContent.items[i] as any;
    if (!item.str || item.str.trim() === '') continue;

    const transform = item.transform;
    const x = transform[4];
    const y = transform[5];
    const fontSize =
      Math.hypot(transform[2], transform[3]) ||
      Math.hypot(transform[0], transform[1]) ||
      item.height ||
      12;
    const width = item.width || item.str.length * fontSize * 0.55;
    const height = item.height || fontSize;

    const fontStyleObj = styles[item.fontName] || {};
    const fontDesc = fontDescriptors.get(item.fontName) || {};
    const otInfo = openTypeMetadata.get(item.fontName) || null;

    // Gather all known naming sources for this font
    const pdfFontName = fontDesc.name || '';
    const otFamilyName = otInfo?.names[1] || '';
    const otSubfamilyName = otInfo?.names[2] || '';
    const otFullName = otInfo?.names[4] || '';
    const otPsName = otInfo?.names[6] || '';
    const sysBaseName = fontDesc.systemFontInfo?.baseFontName || '';
    const cssFontFamily = fontDesc.cssFontInfo?.fontFamily || '';
    const cssFontWeight = String(fontDesc.cssFontInfo?.fontWeight || '');
    const styleSubName = fontStyleObj.fontSubstitutionLoadedName || fontStyleObj.fontSubstitution || '';
    const fallbackFamily = fontDesc.fallbackName || fontStyleObj.fontFamily || '';

    const combinedFontStr = [
      pdfFontName,
      otFamilyName,
      otSubfamilyName,
      otFullName,
      otPsName,
      sysBaseName,
      cssFontFamily,
      styleSubName,
      fontDesc.loadedName || '',
      fallbackFamily,
    ]
      .join(' ')
      .toLowerCase();

    const isLightWeight = /light|thin|hairline|extralight|ultralight/i.test(combinedFontStr);

    // Accurate bold detection across PDF descriptor, OpenType OS/2 & head tables, CSS weight, keywords, and Tr=2 faux bold
    const isBold = Boolean(
      fontDesc.bold === true ||
        fontDesc.black === true ||
        fontStyleObj.bold === true ||
        otInfo?.isBold === true ||
        fauxBoldSet.has(item.str.trim()) ||
        Number(cssFontWeight) >= 600 ||
        cssFontWeight.toLowerCase() === 'bold' ||
        (!isLightWeight &&
          (combinedFontStr.includes('bold') ||
            combinedFontStr.includes('black') ||
            combinedFontStr.includes('heavy') ||
            combinedFontStr.includes('semibold') ||
            combinedFontStr.includes('demibold') ||
            combinedFontStr.includes('extrabold') ||
            combinedFontStr.includes('ultrabold') ||
            combinedFontStr.includes('medium') ||
            combinedFontStr.includes('negrito') ||
            combinedFontStr.includes('negrita') ||
            combinedFontStr.includes('gras') ||
            combinedFontStr.includes('fett') ||
            /(?:^|[-,_+ ])(bd|bld|demi|medi|semibd|blk|cmbx|cmb\d)/i.test(combinedFontStr) ||
            /(?:[-,_ ])(600|700|800|900|w6|w7|w8|w9)(?:$|[^0-9])/i.test(combinedFontStr)))
    );

    // Accurate italic/oblique detection across PDF descriptor, OpenType tables, and multi-language style keywords
    const isItalic = Boolean(
      fontDesc.italic === true ||
        fontStyleObj.italic === true ||
        otInfo?.isItalic === true ||
        Boolean(fontDesc.cssFontInfo?.italicAngle && Number(fontDesc.cssFontInfo.italicAngle) !== 0) ||
        combinedFontStr.includes('italic') ||
        combinedFontStr.includes('oblique') ||
        combinedFontStr.includes('slanted') ||
        combinedFontStr.includes('italico') ||
        combinedFontStr.includes('itálico') ||
        combinedFontStr.includes('italique') ||
        combinedFontStr.includes('cursiva') ||
        combinedFontStr.includes('kursiv') ||
        /(?:^|[-,_+ ])(it|ita|obl|inclined|cmti|cmsl)/i.test(combinedFontStr)
    );

    const isMonospace = Boolean(
      fontDesc.isMonospace === true ||
        otInfo?.isMonospace === true ||
        fallbackFamily.toLowerCase() === 'monospace'
    );

    const isSerif = Boolean(
      !isMonospace &&
        (fontDesc.isSerifFont === true ||
          otInfo?.isSerif === true ||
          fallbackFamily.toLowerCase() === 'serif')
    );

    // Clean the primary family name (strip subset prefix like "BCDEEE+" and style suffixes like "-BoldMT")
    const rawPrimaryName = (otFamilyName || pdfFontName || sysBaseName || '')
      .replace(/^[A-Z]{6}\+/i, '')
      .split(/[-,_]/)[0]
      .replace(/(PS|MT|Std|Pro|LT|W1G|Regular|Bold|Italic|Oblique)$/i, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim();

    const fontFamily = resolveMatchingFontStack(combinedFontStr, rawPrimaryName, isSerif, isMonospace);
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
      fontName: rawPrimaryName || pdfFontName || item.fontName || 'Helvetica',
      fontFamily,
      isDeleted: false,
      hasBeenModified: false,
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
 * Preserves the exact font family classification, weight, slant, size, and position.
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
        const isModified = item.currentText !== item.originalText || Boolean(item.hasBeenModified);
        const isDeleted = item.isDeleted;

        if (isModified || isDeleted) {
          const descentPad = Math.max(2.5, (item.fontSize || 12) * 0.22);
          copiedPage.drawRectangle({
            x: Math.max(0, item.x - 1.5),
            y: Math.max(0, item.y - descentPad),
            width: item.width + 4,
            height: item.height + descentPad + 2,
            color: rgb(1, 1, 1),
          });

          if (!isDeleted && item.currentText.trim() !== '') {
            const fam = `${item.fontFamily || ''} ${item.fontName || ''}`.toLowerCase();
            let font = fonts.helvetica;

            const isMono =
              fam.includes('courier') ||
              fam.includes('cousine') ||
              fam.includes('consolas') ||
              fam.includes('menlo') ||
              fam.includes('monaco') ||
              fam.includes('monospace');

            const isSerif =
              !isMono &&
              (fam.includes('times') ||
                fam.includes('tinos') ||
                fam.includes('georgia') ||
                fam.includes('garamond') ||
                fam.includes('cambria') ||
                fam.includes('caladea') ||
                fam.includes('merriweather') ||
                fam.includes('palatino') ||
                fam.includes('baskerville') ||
                (fam.includes('serif') && !fam.includes('sans-serif')));

            if (isSerif) {
              if (item.isBold && item.isItalic) font = fonts.timesBoldItalic;
              else if (item.isBold) font = fonts.timesBold;
              else if (item.isItalic) font = fonts.timesItalic;
              else font = fonts.times;
            } else if (isMono) {
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
