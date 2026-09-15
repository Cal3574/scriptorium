import { createCanvas } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
// The legacy Node build (not the browser bundle the client uses): it runs
// without a DOM, falling back to a synchronous "fake worker" in-process, and
// - the moment `@napi-rs/canvas` is resolvable, which it always is here since
// it is a direct dependency of this package (and pdf.js's own declared
// `optionalDependencies` entry, so this is the library-sanctioned Node setup)
// - self-polyfills `DOMMatrix` / `Path2D` onto `globalThis` and renders
// through it internally for masks and patterns. Both packages are
// permissively licensed (Apache-2.0 / MIT) and ship prebuilt binaries for the
// worker's `node:*-bookworm-slim` runtime, so no system package (poppler,
// cairo, ...) or native build step is needed.
//
// A namespace import, not named imports: mirrors the client's own
// `pdf-preview.ts` (`import * as pdfjs from 'pdfjs-dist'`).
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

// pdf.js does not export its `render()` parameter type by name; derive it
// from the method itself rather than hand-duplicating the shape.
type RenderParams = Parameters<PDFPageProxy['render']>[0];

// The "fake worker" fallback pdf.js uses when it cannot spin up a real
// worker thread (this module's only mode - nothing here ever sets up a
// `Worker`) still dynamically imports the *separate* `pdf.worker.mjs`
// module for the actual parsing engine. Left to its own default
// (`workerSrc = "./pdf.worker.mjs"`, resolved relative to wherever the
// *bundled* output ends up on disk) that import fails once this module is
// webpacked into the worker app's `dist/main.js`, which has no such sibling
// file. Resolving it with `require.resolve` against `pdfjs-dist`'s own
// installed location - unaffected by bundling, since it asks Node's real
// module resolution for a concrete path - is the fix pdf.js's own Node
// examples use.
//
// `createRequire` is anchored on `process.argv[1]` (the running script's own
// path), not `import.meta.url`: the latter is what this file would normally
// use, but referencing it here trips a webpack build error ("Cannot get
// final name for export '__esModule'") once this module is concatenated
// into the worker app's bundle - a known category of `ModuleConcatenation`
// versus `import.meta` conflict. `process.argv[1]` resolves to the same
// place in every context that matters (`node dist/main.js` in the built
// app; the test runner's own entry point in Jest) without tripping it.
let workerSrcConfigured = false;
function ensureWorkerSrc(): void {
  if (workerSrcConfigured) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = createRequire(
    process.argv[1] ?? process.cwd(),
  ).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  workerSrcConfigured = true;
}

// Matches the width the client already renders for the deposit-slip preview
// (`renderPdfPreview` in `@scriptorium/client`) - crisp on a retina library
// card, small enough to store inline as a `data:` URL.
const COVER_WIDTH = 240;

export interface PdfCover {
  dataUrl: string;
}

/**
 * Render a PDF's first page to a small PNG `data:` URL, server-side. Used by
 * the worker's cover-backfill job for books uploaded before the client
 * started sending its own rendered thumbnail, and available for the ingest
 * pipeline to use as a fallback for any future upload that arrives without
 * one.
 *
 * Throws on a corrupt, empty, or password-protected PDF - exactly like the
 * client's own `renderPdfPreview` - so callers treat that as "no cover
 * available" and move on rather than surfacing a hard failure.
 */
export async function renderPdfCover(pdfBytes: Uint8Array): Promise<PdfCover> {
  ensureWorkerSrc();

  // pdf.js explicitly rejects a Node `Buffer` (throws "Please provide binary
  // data as Uint8Array, rather than Buffer") even though `Buffer` is a
  // `Uint8Array` subclass - and every real caller (`ObjectStorage.getObject`
  // implementations, S3 SDKs, `fs.readFile`) is liable to hand us one. Wrap
  // to a plain `Uint8Array` view over the same bytes rather than pushing that
  // footgun onto every caller.
  const data =
    Object.getPrototypeOf(pdfBytes) === Uint8Array.prototype
      ? pdfBytes
      : new Uint8Array(
          pdfBytes.buffer,
          pdfBytes.byteOffset,
          pdfBytes.byteLength,
        );

  const task = pdfjsLib.getDocument({ data, useSystemFonts: true });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: COVER_WIDTH / base.width });

    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    const canvasContext = canvas.getContext('2d');

    // pdf.js's public type wants a DOM `HTMLCanvasElement` /
    // `CanvasRenderingContext2D`; `@napi-rs/canvas` implements the same
    // surface for Node (the reason pdf.js's own Node build depends on it -
    // see the import above), so this cast is the one seam between the two.
    const renderParams = {
      canvas,
      canvasContext,
    } as unknown as RenderParams;

    await page.render({ ...renderParams, viewport }).promise;

    const png = canvas.toBuffer('image/png');
    return { dataUrl: `data:image/png;base64,${png.toString('base64')}` };
  } finally {
    // Mirrors the client's own `renderPdfPreview` teardown
    // (`@scriptorium/client`): destroying the *loading task*, not the
    // resolved document, is what actually frees the parsed structures.
    await task.destroy();
  }
}
