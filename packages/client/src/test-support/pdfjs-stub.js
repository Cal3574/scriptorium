// Stands in for the `pdfjs-dist` ESM entry under Jest (see jest.config.cjs).
// The real package uses `import.meta` and ships only as ESM, which the SWC
// transform does not pick up from node_modules. Specs that exercise a PDF
// preview mock `@/books/pdf-preview` wholesale, so this stub only has to keep
// the module graph loading; calling into it is a test bug.
module.exports = {
  GlobalWorkerOptions: {},
  getDocument() {
    throw new Error('pdfjs-dist is stubbed under Jest; mock @/books/pdf-preview');
  },
};
