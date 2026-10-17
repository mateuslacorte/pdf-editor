export interface ExtractedTextItem {
  id: string;
  originalText: string;
  currentText: string;
  x: number; // in PDF points from left
  y: number; // in PDF points from bottom
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  fontFamily: string;
  isDeleted: boolean;
  color: string;
  isBold: boolean;
  isItalic: boolean;
  hasBeenModified?: boolean;
  isCustomAdded?: boolean;
}

export interface ExtractedImageItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl?: string;
  replacementDataUrl?: string;
  isDeleted: boolean;
  isCustomAdded?: boolean;
  isSignature?: boolean;
}

export interface PDFPageItem {
  id: string;
  fileId: string;
  fileName: string;
  pageIndex: number;
  pageNumber: number;
  thumbnailUrl: string;
  rotation: number;
  selectedForSplit: boolean;
  width: number;
  height: number;
  textItems: ExtractedTextItem[];
  imageItems: ExtractedImageItem[];
  isParsedForEditing?: boolean;
}
