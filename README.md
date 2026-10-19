# PDF Editor

A fast, lightweight, and privacy-first client-side PDF document manipulation suite built with **Next.js (App Router)**, **TypeScript**, **Tailwind CSS**, **pdf-lib**, and **pdfjs-dist**.

All rendering and manipulation is performed directly in the user's browser, ensuring zero data retention and maximum speed.

## Features

- **Continuous Microsoft Word-Style Editor**: Seamless vertical scrolling through document pages with intuitive thumbnail navigation.
- **Page Deletion**: Delete unwanted pages with one click directly from the thumbnail sidebar or page canvas header.
- **Drag-and-Drop Page Reordering**: Effortlessly reorganize document structure by dragging thumbnails into target positions.
- **Combine & Merge PDFs**: Append additional PDF documents on-the-fly.
- **In-Place Text Editing**: Modify text with accurate font family matching, bold/italic detection, color, and size preservation.
- **Image & Signature Tools**: Insert, replace, reposition, and resize images and handwritten digital signatures while locking intrinsic aspect ratios.
- **Bleed & Crop Handling**: Full out-of-page visibility during editing with clean page boundary clipping on export.
- **High-Performance Architecture**: 60+ FPS hardware-accelerated transforms for fluid dragging and resizing.

## Getting Started

### Prerequisites

- Node.js 18+ (tested on Node 20 / 24)
- npm, pnpm, or yarn

### Installation

```bash
npm install
```

### Production Build & Run

To build and run in production mode:

```bash
npm run build
npm run start
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

### Development

```bash
npm run dev
```

## License

MIT
