'use client';

import React, { useRef, useState } from 'react';
import { UploadCloud, FileUp, ShieldCheck, Sparkles, Loader2 } from 'lucide-react';

interface FileDropzoneProps {
  onFilesSelected: (files: File[]) => void;
  isLoading: boolean;
}

export const FileDropzone: React.FC<FileDropzoneProps> = ({ onFilesSelected, isLoading }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const validPdfs = Array.from(e.dataTransfer.files).filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      );
      if (validPdfs.length > 0) {
        onFilesSelected(validPdfs);
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const validPdfs = Array.from(e.target.files).filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      );
      if (validPdfs.length > 0) {
        onFilesSelected(validPdfs);
      }
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-xl flex flex-col items-center">
        {/* Clean Logo Header */}
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/20 font-bold">
            <FileUp className="w-5 h-5" />
          </div>
          <span className="text-xl font-bold text-slate-900 tracking-tight">PDF MVP</span>
        </div>

        {/* Minimal Dropzone Card */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !isLoading && inputRef.current?.click()}
          className={`w-full rounded-2xl border-2 border-dashed p-14 flex flex-col items-center justify-center cursor-pointer transition-all duration-200 bg-white shadow-sm ${
            isDragOver
              ? 'border-indigo-600 bg-indigo-50/50 scale-[1.01]'
              : 'border-slate-300 hover:border-indigo-500 hover:shadow-md'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={handleInputChange}
            disabled={isLoading}
          />

          <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 mb-5">
            {isLoading ? (
              <Loader2 className="w-8 h-8 animate-spin" />
            ) : (
              <UploadCloud className="w-8 h-8" />
            )}
          </div>

          <h2 className="text-lg font-semibold text-slate-800 text-center mb-1">
            {isLoading ? 'Loading & parsing document...' : 'Upload your PDF document'}
          </h2>
          <p className="text-sm text-slate-500 text-center mb-6">
            Drag and drop your file here, or browse from your computer
          </p>

          <button
            type="button"
            disabled={isLoading}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-sm transition disabled:opacity-50"
          >
            Choose PDF File
          </button>
        </div>
      </div>
    </div>
  );
};
