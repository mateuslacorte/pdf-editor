'use client';

import React, { useState, useRef, useEffect } from 'react';
import { 
  Plus, 
  Trash2, 
  Bold, 
  Italic, 
  Download, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  FileUp, 
  Image as ImageIcon, 
  Move, 
  Undo2,
  MousePointer2,
  GripVertical,
  PenTool,
  Upload
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { PDFPageItem, ExtractedTextItem, ExtractedImageItem } from '@/types/pdf';
import { exportPDFDocument } from '@/lib/pdf-engine';
import { SignatureModal } from '@/components/SignatureModal';

interface WordStyleEditorProps {
  pages: PDFPageItem[];
  fileMap: Map<string, ArrayBuffer>;
  onUpdatePages: (updatedPages: PDFPageItem[]) => void;
  onUploadMore: (files: File[]) => void;
  onReset: () => void;
}

export const WordStyleEditor: React.FC<WordStyleEditorProps> = ({
  pages,
  fileMap,
  onUpdatePages,
  onUploadMore,
  onReset,
}) => {
  const [selectedElement, setSelectedElement] = useState<{
    pageIndex: number;
    type: 'text' | 'image';
    id: string;
  } | null>(null);

  const [zoomScale, setZoomScale] = useState<number>(1.0);
  const [draggedPageIndex, setDraggedPageIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState<boolean>(false);
  const [signatureTargetPageIndex, setSignatureTargetPageIndex] = useState<number>(0);

  // Dragging image element
  const [isImageDragging, setIsImageDragging] = useState<boolean>(false);
  const imageDragRef = useRef<{ startX: number; startY: number; itemX: number; itemY: number; pageIndex: number; imgId: string } | null>(null);

  // Resizing image element (locked aspect ratio)
  const [isImageResizing, setIsImageResizing] = useState<boolean>(false);
  const imageResizeRef = useRef<{
    startX: number;
    initialWidth: number;
    initialHeight: number;
    initialX: number;
    initialY: number;
    aspectRatio: number;
    pageIndex: number;
    imgId: string;
  } | null>(null);

  // High-performance live transformation during active drag/resize (prevents full document re-renders)
  const [activeTransform, setActiveTransform] = useState<{
    id: string;
    dx: number;
    dy: number;
    dWidth: number;
    dHeight: number;
  } | null>(null);

  const rafRef = useRef<number | null>(null);
  const latestTransformRef = useRef<{
    id: string;
    pageIndex: number;
    newX: number;
    newY: number;
    newWidth: number;
    newHeight: number;
  } | null>(null);

  const uploadMoreInputRef = useRef<HTMLInputElement>(null);
  const imageInsertInputRef = useRef<HTMLInputElement>(null);
  const imageReplaceInputRef = useRef<HTMLInputElement>(null);
  const mainContainerRef = useRef<HTMLElement>(null);

  // Ctrl / Cmd + Scroll Wheel to Zoom Document
  useEffect(() => {
    const mainEl = mainContainerRef.current;
    if (!mainEl) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const zoomDelta = e.deltaY < 0 ? 0.08 : -0.08;
        setZoomScale((prev) => {
          const next = prev + zoomDelta;
          return Math.min(2.5, Math.max(0.4, Number(next.toFixed(2))));
        });
      }
    };

    mainEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      mainEl.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // 60+ FPS Hardware-accelerated mouse movement handler
  const handleGlobalMouseMove = (e: React.MouseEvent) => {
    if (!isImageResizing && !isImageDragging) return;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    rafRef.current = requestAnimationFrame(() => {
      if (isImageResizing && imageResizeRef.current) {
        const { startX, initialWidth, initialHeight, initialX, initialY, aspectRatio, pageIndex, imgId } = imageResizeRef.current;
        const dx = (e.clientX - startX) / zoomScale;

        const newWidth = Math.max(30, initialWidth + dx);
        const newHeight = newWidth / aspectRatio;
        const dWidth = newWidth - initialWidth;
        const dHeight = newHeight - initialHeight;

        setActiveTransform({
          id: imgId,
          dx: 0,
          dy: 0,
          dWidth,
          dHeight,
        });

        latestTransformRef.current = {
          id: imgId,
          pageIndex,
          newX: initialX,
          newY: Math.round(initialY - dHeight),
          newWidth: Math.round(newWidth),
          newHeight: Math.round(newHeight),
        };
        return;
      }

      if (isImageDragging && imageDragRef.current) {
        const { startX, startY, itemX, itemY, pageIndex, imgId } = imageDragRef.current;
        const dx = (e.clientX - startX) / zoomScale;
        const dy = (e.clientY - startY) / zoomScale;

        setActiveTransform({
          id: imgId,
          dx,
          dy,
          dWidth: 0,
          dHeight: 0,
        });

        const curImg = pages[pageIndex]?.imageItems.find((i) => i.id === imgId);
        latestTransformRef.current = {
          id: imgId,
          pageIndex,
          newX: Math.round(itemX + dx),
          newY: Math.round(itemY - dy),
          newWidth: curImg ? curImg.width : 100,
          newHeight: curImg ? curImg.height : 100,
        };
      }
    });
  };

  const handleGlobalMouseUp = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Commit final transformed coordinates only on mouse release
    if (latestTransformRef.current) {
      const { pageIndex, id, newX, newY, newWidth, newHeight } = latestTransformRef.current;
      const newPages = pages.map((page, pIdx) => {
        if (pIdx !== pageIndex) return page;
        return {
          ...page,
          imageItems: page.imageItems.map((img) =>
            img.id === id
              ? {
                  ...img,
                  x: newX,
                  y: newY,
                  width: newWidth,
                  height: newHeight,
                }
              : img
          ),
        };
      });
      onUpdatePages(newPages);
      latestTransformRef.current = null;
    }

    setActiveTransform(null);
    setIsImageDragging(false);
    imageDragRef.current = null;
    setIsImageResizing(false);
    imageResizeRef.current = null;
  };

  // Active element helper
  const activePage = selectedElement ? pages[selectedElement.pageIndex] : null;
  const activeText = activePage && selectedElement?.type === 'text'
    ? activePage.textItems.find((t) => t.id === selectedElement.id)
    : null;
  const activeImage = activePage && selectedElement?.type === 'image'
    ? activePage.imageItems.find((i) => i.id === selectedElement.id)
    : null;

  // Update text item properties
  const updateSelectedText = (updates: Partial<ExtractedTextItem>) => {
    if (!selectedElement || selectedElement.type !== 'text') return;
    const { pageIndex, id } = selectedElement;

    const newPages = pages.map((page, pIdx) => {
      if (pIdx !== pageIndex) return page;
      return {
        ...page,
        textItems: page.textItems.map((item) =>
          item.id === id ? { ...item, ...updates } : item
        ),
      };
    });
    onUpdatePages(newPages);
  };

  // Delete selected item (text or image)
  const handleDeleteSelected = () => {
    if (!selectedElement) return;
    const { pageIndex, type, id } = selectedElement;

    const newPages = pages.map((page, pIdx) => {
      if (pIdx !== pageIndex) return page;
      if (type === 'text') {
        return {
          ...page,
          textItems: page.textItems.map((item) =>
            item.id === id ? { ...item, isDeleted: true } : item
          ),
        };
      } else {
        return {
          ...page,
          imageItems: page.imageItems.map((item) =>
            item.id === id ? { ...item, isDeleted: true } : item
          ),
        };
      }
    });

    onUpdatePages(newPages);
    setSelectedElement(null);
  };

  // Revert selected item
  const handleRevertSelected = () => {
    if (!selectedElement || selectedElement.type !== 'text') return;
    const { pageIndex, id } = selectedElement;

    const newPages = pages.map((page, pIdx) => {
      if (pIdx !== pageIndex) return page;
      return {
        ...page,
        textItems: page.textItems.map((item) =>
          item.id === id
            ? { ...item, currentText: item.originalText, isDeleted: false }
            : item
        ),
      };
    });
    onUpdatePages(newPages);
  };

  // Reordering page thumbnails: drag page to be placed AFTER target page
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedPageIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedPageIndex === null || draggedPageIndex === targetIndex) {
      setDragOverIndex(null);
      setDraggedPageIndex(null);
      return;
    }

    const reordered = [...pages];
    const [movedPage] = reordered.splice(draggedPageIndex, 1);

    let insertIndex = targetIndex;
    if (draggedPageIndex < targetIndex) {
      insertIndex = targetIndex;
    } else {
      insertIndex = targetIndex + 1;
    }

    reordered.splice(insertIndex, 0, movedPage);

    const updatedWithNumbers = reordered.map((p, idx) => ({
      ...p,
      pageNumber: idx + 1,
    }));

    onUpdatePages(updatedWithNumbers);
    setDraggedPageIndex(null);
    setDragOverIndex(null);
  };

  // Determine which page is primarily visible in the continuous scroll view
  const getVisiblePageIndex = (): number => {
    const mainEl = mainContainerRef.current;
    if (!mainEl || pages.length === 0) return 0;

    const mainRect = mainEl.getBoundingClientRect();
    const viewportCenterY = mainRect.top + mainRect.height / 2;

    let bestPageIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < pages.length; i++) {
      const pageEl = document.getElementById(`document-page-${i}`);
      if (pageEl) {
        const pageRect = pageEl.getBoundingClientRect();
        const pageCenterY = pageRect.top + pageRect.height / 2;
        const distance = Math.abs(pageCenterY - viewportCenterY);

        if (distance < minDistance) {
          minDistance = distance;
          bestPageIndex = i;
        }
      }
    }

    return bestPageIndex;
  };

  // Insert a new Image on the currently visible page
  const handleInsertImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const targetIdx = selectedElement ? selectedElement.pageIndex : getVisiblePageIndex();
      const targetPage = pages[targetIdx] || pages[0];

      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          const resultUrl = event.target.result as string;
          const imgLoader = new Image();
          imgLoader.onload = () => {
            const naturalW = imgLoader.naturalWidth || 200;
            const naturalH = imgLoader.naturalHeight || 150;
            const ratio = naturalW / naturalH;

            // Compute ideal dimensions fitting gracefully on the page
            let targetWidth = Math.min(260, (targetPage.width || 612) * 0.45);
            let targetHeight = targetWidth / ratio;

            const maxHeight = (targetPage.height || 792) * 0.55;
            if (targetHeight > maxHeight) {
              targetHeight = maxHeight;
              targetWidth = targetHeight * ratio;
            }

            const finalW = Math.round(targetWidth);
            const finalH = Math.round(targetHeight);

            const newImg: ExtractedImageItem = {
              id: `custom-img-${Date.now()}`,
              x: Math.round((targetPage.width || 612) / 2 - finalW / 2),
              y: Math.round((targetPage.height || 792) / 2 - finalH / 2),
              width: finalW,
              height: finalH,
              replacementDataUrl: resultUrl,
              isDeleted: false,
              isCustomAdded: true,
            };

            const newPages = pages.map((page, pIdx) => {
              if (pIdx !== targetIdx) return page;
              return {
                ...page,
                imageItems: [...page.imageItems, newImg],
              };
            });

            onUpdatePages(newPages);
            setSelectedElement({ pageIndex: targetIdx, type: 'image', id: newImg.id });
          };
          imgLoader.src = resultUrl;
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Replace existing selected image
  const handleReplaceImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedElement || selectedElement.type !== 'image') return;
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const { pageIndex, id } = selectedElement;

      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          const resultUrl = event.target.result as string;
          const imgLoader = new Image();
          imgLoader.onload = () => {
            const naturalW = imgLoader.naturalWidth || 200;
            const naturalH = imgLoader.naturalHeight || 150;

            const newPages = pages.map((page, pIdx) => {
              if (pIdx !== pageIndex) return page;
              return {
                ...page,
                imageItems: page.imageItems.map((img) => {
                  if (img.id !== id) return img;
                  // Preserve width and update height to match new image's natural aspect ratio
                  const newHeight = Math.round(img.width * (naturalH / naturalW));
                  const dHeight = newHeight - img.height;
                  return {
                    ...img,
                    y: Math.round(img.y - dHeight),
                    height: newHeight,
                    replacementDataUrl: resultUrl,
                    isDeleted: false,
                  };
                }),
              };
            });
            onUpdatePages(newPages);
          };
          imgLoader.src = resultUrl;
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Insert drawn signature
  const handleInsertSignature = (signatureDataUrl: string) => {
    const targetIdx = signatureTargetPageIndex;
    const targetPage = pages[targetIdx];

    const sigImg: ExtractedImageItem = {
      id: `sig-${Date.now()}`,
      x: (targetPage.width || 612) / 2 - 80,
      y: 120, // default near bottom signature line
      width: 160,
      height: 64,
      replacementDataUrl: signatureDataUrl,
      isDeleted: false,
      isCustomAdded: true,
      isSignature: true,
    };

    const newPages = pages.map((page, pIdx) => {
      if (pIdx !== targetIdx) return page;
      return {
        ...page,
        imageItems: [...page.imageItems, sigImg],
      };
    });

    onUpdatePages(newPages);
    setSelectedElement({ pageIndex: targetIdx, type: 'image', id: sigImg.id });
  };

  // Start dragging an image on the page
  const handleImageMouseDown = (e: React.MouseEvent, pageIndex: number, img: ExtractedImageItem) => {
    e.stopPropagation();
    setSelectedElement({ pageIndex, type: 'image', id: img.id });
    imageDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      itemX: img.x,
      itemY: img.y,
      pageIndex,
      imgId: img.id,
    };
    setIsImageDragging(true);
  };

  // Scroll to page
  const scrollToPage = (pageIndex: number) => {
    const el = document.getElementById(`document-page-${pageIndex}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Export modified PDF
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const pdfBytes = await exportPDFDocument(pages, fileMap);
      const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `document-edited-${Date.now()}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      confetti({ particleCount: 70, spread: 60, origin: { y: 0.6 } });
    } catch (err: any) {
      console.error(err);
      alert('Error generating PDF: ' + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div 
      className="h-screen w-full flex flex-col bg-slate-100 text-slate-800 select-none overflow-hidden font-sans"
      onMouseMove={handleGlobalMouseMove}
      onMouseUp={handleGlobalMouseUp}
    >
      {/* TOP MICROSOFT WORD / GOOGLE DOCS STYLE RIBBON */}
      <header className="h-14 bg-white border-b border-slate-200 px-5 flex items-center justify-between z-30 shrink-0 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
              <FileUp className="w-4 h-4" />
            </div>
            <span className="font-semibold text-slate-900 text-sm hidden sm:inline">
              PDF MVP
            </span>
          </div>

          <div className="h-5 w-px bg-slate-200 mx-1" />

          {/* Add more files / Combine PDFs */}
          <button
            type="button"
            onClick={() => uploadMoreInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition"
            title="Combine another PDF into this document"
          >
            <Plus className="w-3.5 h-3.5 text-indigo-600" /> Add PDF (Combine)
          </button>
          <input
            ref={uploadMoreInputRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) onUploadMore(Array.from(e.target.files));
            }}
          />

          {/* Insert Image */}
          <button
            type="button"
            onClick={() => imageInsertInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition"
            title="Insert image onto document"
          >
            <ImageIcon className="w-3.5 h-3.5 text-emerald-600" /> Insert Image
          </button>
          <input
            ref={imageInsertInputRef}
            type="file"
            accept="image/png, image/jpeg"
            className="hidden"
            onChange={handleInsertImageFile}
          />

          {/* Add Signature */}
          <button
            type="button"
            onClick={() => {
              setSignatureTargetPageIndex(selectedElement ? selectedElement.pageIndex : getVisiblePageIndex());
              setIsSignatureModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition"
            title="Draw and place signature"
          >
            <PenTool className="w-3.5 h-3.5 text-indigo-600" /> Add Signature
          </button>
        </div>

        {/* CONTEXTUAL WORD-STYLE TEXT TOOLBAR */}
        {activeText ? (
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-3 py-1 rounded-xl shadow-xs animate-fadeIn">
            {/* Font Size controls */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 px-2 py-0.5 rounded text-xs">
              <span className="font-mono font-medium text-slate-800">
                {activeText.fontSize}pt
              </span>
              <div className="flex flex-col ml-1">
                <button
                  type="button"
                  onClick={() => updateSelectedText({ fontSize: Math.min(96, (activeText.fontSize || 12) + 1) })}
                  className="text-[9px] hover:text-indigo-600 leading-none px-0.5"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => updateSelectedText({ fontSize: Math.max(6, (activeText.fontSize || 12) - 1) })}
                  className="text-[9px] hover:text-indigo-600 leading-none px-0.5"
                >
                  ▼
                </button>
              </div>
            </div>

            {/* Bold */}
            <button
              type="button"
              onClick={() => updateSelectedText({ isBold: !activeText.isBold })}
              className={`p-1.5 rounded border text-xs font-bold transition ${
                activeText.isBold
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
              title="Bold"
            >
              <Bold className="w-3.5 h-3.5" />
            </button>

            {/* Italic */}
            <button
              type="button"
              onClick={() => updateSelectedText({ isItalic: !activeText.isItalic })}
              className={`p-1.5 rounded border text-xs transition ${
                activeText.isItalic
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
              title="Italic"
            >
              <Italic className="w-3.5 h-3.5" />
            </button>

            {/* Color picker */}
            <div className="flex items-center gap-1 pl-1">
              <input
                type="color"
                value={activeText.color || '#000000'}
                onChange={(e) => updateSelectedText({ color: e.target.value })}
                className="w-6 h-6 rounded cursor-pointer border border-slate-300 p-0"
                title="Change Color"
              />
            </div>

            <div className="h-4 w-px bg-slate-200 mx-1" />

            {/* Revert / Delete */}
            <button
              type="button"
              onClick={handleRevertSelected}
              className="p-1.5 text-slate-500 hover:text-slate-800 rounded hover:bg-slate-100"
              title="Revert text to original"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={handleDeleteSelected}
              className="p-1.5 text-rose-500 hover:text-rose-600 rounded hover:bg-rose-50"
              title="Delete / Erase text"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : activeImage ? (
          /* CONTEXTUAL IMAGE TOOLBAR */
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1 rounded-xl shadow-xs animate-fadeIn">
            <span className="text-xs font-bold text-slate-700">
              {activeImage.isSignature ? 'Signature' : 'Image'} Selected
            </span>

            <button
              type="button"
              onClick={() => imageReplaceInputRef.current?.click()}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg shadow-xs"
            >
              <Upload className="w-3 h-3 text-indigo-600" /> Replace
            </button>
            <input
              ref={imageReplaceInputRef}
              type="file"
              accept="image/png, image/jpeg"
              className="hidden"
              onChange={handleReplaceImageFile}
            />

            <button
              type="button"
              onClick={handleDeleteSelected}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white border border-rose-200 hover:bg-rose-50 text-rose-600 rounded-lg shadow-xs"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        ) : (
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <MousePointer2 className="w-3.5 h-3.5 text-indigo-500" />
            <span>Click text to edit • Drag elements to reposition</span>
          </div>
        )}

        {/* Right side Actions (Zoom & Export) */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg">
            <button
              type="button"
              onClick={() => setZoomScale((z) => Math.max(0.4, Number((z - 0.1).toFixed(2))))}
              className="p-1 text-slate-600 hover:text-slate-900"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-mono font-medium text-slate-700 min-w-[40px] text-center">
              {Math.round(zoomScale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoomScale((z) => Math.min(2.5, Number((z + 0.1).toFixed(2))))}
              className="p-1 text-slate-600 hover:text-slate-900"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {isExporting ? 'Exporting...' : 'Export PDF'}
          </button>
        </div>
      </header>

      {/* MAIN TWO-COLUMN WORKSPACE: LEFT THUMBNAILS + CONTINUOUS WORD DOCUMENT */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT PAGE THUMBNAILS REORDER SIDEBAR */}
        <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-hidden shadow-xs">
          <div className="p-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Pages ({pages.length})
            </span>
            <span className="text-[11px] text-slate-500">Drag after to reorder</span>
          </div>

          {/* Thumbnail list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {pages.map((page, index) => {
              const isBeingDragged = draggedPageIndex === index;
              const isDropTarget = dragOverIndex === index;

              return (
                <div key={page.id} className="relative">
                  <div
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, index)}
                    onClick={() => scrollToPage(index)}
                    className={`group relative rounded-xl border p-2 cursor-pointer transition-all duration-150 bg-white shadow-xs ${
                      isBeingDragged
                        ? 'opacity-40 border-indigo-400'
                        : isDropTarget
                        ? 'border-indigo-600 ring-2 ring-indigo-500/30'
                        : 'border-slate-200 hover:border-indigo-400 hover:shadow-sm'
                    }`}
                  >
                    {/* Header info */}
                    <div className="flex items-center justify-between mb-1.5 text-xs text-slate-600">
                      <div className="flex items-center gap-1 cursor-grab active:cursor-grabbing">
                        <GripVertical className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600" />
                        <span className="font-bold text-[11px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                          Page {index + 1}
                        </span>
                      </div>
                    </div>

                    {/* Thumbnail preview image */}
                    <div className="relative rounded overflow-hidden bg-slate-50 flex items-center justify-center border border-slate-100 aspect-[3/4]">
                      {page.thumbnailUrl && (
                        <img
                          src={page.thumbnailUrl}
                          alt={`Thumbnail ${page.pageNumber}`}
                          className="w-full h-full object-contain pointer-events-none"
                        />
                      )}
                    </div>
                  </div>

                  {/* DROP AFTER INSERTION LINE INDICATOR */}
                  {isDropTarget && (
                    <div className="absolute -bottom-2 left-0 right-0 h-1 bg-indigo-600 rounded-full z-20 flex items-center justify-between">
                      <div className="w-2.5 h-2.5 rounded-full bg-indigo-600 -ml-1" />
                      <div className="w-2.5 h-2.5 rounded-full bg-indigo-600 -mr-1" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        {/* CONTINUOUS MICROSOFT WORD DOCUMENT CANVAS VIEW */}
        <main
          ref={mainContainerRef}
          onClick={() => setSelectedElement(null)}
          className="flex-1 overflow-y-auto p-10 flex flex-col items-center gap-12 bg-slate-100/90"
        >
          {pages.map((page, pIdx) => {
            const pageWidth = page.width || 612;
            const pageHeight = page.height || 792;

            return (
              <div
                key={page.id}
                id={`document-page-${pIdx}`}
                className="relative bg-white shadow-md border border-slate-200 rounded-sm overflow-visible shrink-0 transition-transform duration-75"
                style={{
                  width: `${pageWidth * zoomScale}px`,
                  height: `${pageHeight * zoomScale}px`,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Crisp Background Raster Page */}
                {page.thumbnailUrl && (
                  <img
                    src={page.thumbnailUrl}
                    alt={`Page ${pIdx + 1}`}
                    className="w-full h-full object-contain pointer-events-none block"
                  />
                )}

                {/* IN-PLACE TEXT BLOCKS */}
                {page.textItems.map((item) => {
                  const isSelected =
                    selectedElement?.pageIndex === pIdx &&
                    selectedElement?.type === 'text' &&
                    selectedElement?.id === item.id;

                  const isModified = item.currentText !== item.originalText;

                  const left = (item.x / pageWidth) * 100;
                  const top = ((pageHeight - item.y - item.height) / pageHeight) * 100;

                  if (item.isDeleted) {
                    return (
                      <div
                        key={item.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedElement({ pageIndex: pIdx, type: 'text', id: item.id });
                        }}
                        className="absolute bg-white border border-rose-400 text-rose-600 text-[10px] flex items-center justify-center px-1 cursor-pointer z-10"
                        style={{
                          left: `${left}%`,
                          top: `${top}%`,
                          height: `${item.height * zoomScale}px`,
                        }}
                      >
                        [Erased]
                      </div>
                    );
                  }

                  // Non-selected, non-modified text stays completely clean over the document
                  if (!isSelected && !isModified) {
                    return (
                      <div
                        key={item.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedElement({ pageIndex: pIdx, type: 'text', id: item.id });
                        }}
                        className="absolute cursor-text hover:outline hover:outline-1 hover:outline-indigo-400 rounded-none"
                        style={{
                          left: `${left}%`,
                          top: `${top}%`,
                          width: `${Math.max(16, item.width * zoomScale)}px`,
                          height: `${Math.max(12, item.height * zoomScale)}px`,
                        }}
                        title="Click to edit text"
                      />
                    );
                  }

                  return (
                    <div
                      key={item.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedElement({ pageIndex: pIdx, type: 'text', id: item.id });
                      }}
                      className={`absolute cursor-text transition-all ${
                        isSelected
                          ? 'ring-2 ring-indigo-500 bg-white z-30 shadow-xs'
                          : 'bg-white z-20 outline outline-1 outline-amber-400'
                      }`}
                      style={{
                        left: `${left}%`,
                        top: `${top}%`,
                        minWidth: `${Math.max(16, item.width * zoomScale)}px`,
                      }}
                    >
                      {isSelected ? (
                        <input
                          type="text"
                          autoFocus
                          value={item.currentText}
                          onChange={(e) => updateSelectedText({ currentText: e.target.value })}
                          className="bg-transparent border-0 outline-none w-full px-1 py-0.5 leading-none"
                          style={{
                            fontFamily: item.fontFamily,
                            fontSize: `${(item.fontSize || 12) * zoomScale}px`,
                            fontWeight: item.isBold ? 'bold' : 'normal',
                            fontStyle: item.isItalic ? 'italic' : 'normal',
                            color: item.color || '#0f172a',
                          }}
                        />
                      ) : (
                        <div
                          className="px-1 py-0.5 whitespace-nowrap leading-none"
                          style={{
                            fontFamily: item.fontFamily,
                            fontSize: `${(item.fontSize || 12) * zoomScale}px`,
                            fontWeight: item.isBold ? 'bold' : 'normal',
                            fontStyle: item.isItalic ? 'italic' : 'normal',
                            color: item.color || '#0f172a',
                          }}
                        >
                          {item.currentText}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* IMAGES & SIGNATURES ON PAGE */}
                {page.imageItems.map((img) => {
                  if (img.isDeleted) return null;
                  const isSelected =
                    selectedElement?.pageIndex === pIdx &&
                    selectedElement?.type === 'image' &&
                    selectedElement?.id === img.id;

                  const isTransforming = activeTransform && activeTransform.id === img.id;
                  const currentWidth = isTransforming ? Math.max(30, img.width + activeTransform.dWidth) : img.width;
                  const currentHeight = isTransforming ? Math.max(20, img.height + activeTransform.dHeight) : img.height;

                  const left = (img.x / pageWidth) * 100;
                  const top = ((pageHeight - img.y - img.height) / pageHeight) * 100;

                  const transformStyle = isTransforming && (activeTransform.dx !== 0 || activeTransform.dy !== 0)
                    ? `translate3d(${activeTransform.dx * zoomScale}px, ${activeTransform.dy * zoomScale}px, 0)`
                    : 'none';

                  return (
                    <div
                      key={img.id}
                      onMouseDown={(e) => handleImageMouseDown(e, pIdx, img)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedElement({ pageIndex: pIdx, type: 'image', id: img.id });
                      }}
                      className={`absolute cursor-move group ${
                        isSelected
                          ? 'ring-2 ring-indigo-500 shadow-md z-30'
                          : 'hover:ring-1 hover:ring-indigo-400 z-20'
                      }`}
                      style={{
                        left: `${left}%`,
                        top: `${top}%`,
                        width: `${currentWidth * zoomScale}px`,
                        height: `${currentHeight * zoomScale}px`,
                        transform: transformStyle,
                        willChange: isTransforming ? 'transform, width, height' : 'auto',
                      }}
                      title="Drag to reposition, click to replace or delete"
                    >
                      {img.replacementDataUrl ? (
                        <img
                          src={img.replacementDataUrl}
                          alt="Document Graphic"
                          className="w-full h-full object-fill pointer-events-none block"
                        />
                      ) : (
                        <div className="w-full h-full border-2 border-dashed border-indigo-400 bg-indigo-50/40 flex items-center justify-center text-xs text-indigo-700 font-medium p-1 text-center">
                          Image Frame
                        </div>
                      )}

                      {/* Reposition drag handle */}
                      {isSelected && (
                        <>
                          <div 
                            className="absolute -top-2.5 -left-2.5 w-5 h-5 bg-indigo-600 text-white rounded-full flex items-center justify-center cursor-move shadow-sm"
                            title="Drag to move"
                          >
                            <Move className="w-3 h-3" />
                          </div>

                          {/* Aspect Ratio Preserving Corner Resize Handle */}
                          <div
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              setIsImageResizing(true);
                              imageResizeRef.current = {
                                startX: e.clientX,
                                initialWidth: img.width,
                                initialHeight: img.height,
                                initialX: img.x,
                                initialY: img.y,
                                aspectRatio: Math.max(0.05, img.width / Math.max(1, img.height)),
                                pageIndex: pIdx,
                                imgId: img.id,
                              };
                            }}
                            className="absolute -bottom-2.5 -right-2.5 w-5 h-5 bg-white border-2 border-indigo-600 rounded-full cursor-nwse-resize shadow-md hover:scale-125 transition-transform flex items-center justify-center"
                            title="Drag to resize (keeps aspect ratio)"
                          >
                            <div className="w-1.5 h-1.5 bg-indigo-600 rounded-full pointer-events-none" />
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Page number watermark badge */}
                <div className="absolute bottom-3 right-4 text-[11px] font-semibold text-slate-400 bg-white/80 px-2 py-0.5 rounded shadow-xs">
                  Page {pIdx + 1}
                </div>
              </div>
            );
          })}
        </main>
      </div>

      {/* SIGNATURE DRAWING MODAL */}
      <SignatureModal
        isOpen={isSignatureModalOpen}
        onClose={() => setIsSignatureModalOpen(false)}
        onSave={handleInsertSignature}
      />
    </div>
  );
};
