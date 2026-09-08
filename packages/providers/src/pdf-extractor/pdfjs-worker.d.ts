// pdfjs-dist ships no types for its worker entry point. We import it only for
// the side effect of registering `globalThis.pdfjsWorker` (see pdfjs-outline.ts).
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs';
