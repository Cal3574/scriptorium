// Stands in for Vite's `?worker` default export under Jest (see
// jest.config.cjs). pdf.js is always mocked in specs, so nothing calls these.
module.exports = class PdfWorkerStub {
  postMessage() {
    return undefined;
  }
  terminate() {
    return undefined;
  }
  addEventListener() {
    return undefined;
  }
  removeEventListener() {
    return undefined;
  }
};
