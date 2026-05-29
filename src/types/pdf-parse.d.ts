// Ambient type declaration for pdf-parse's internal entry point.
// The package root has debug code that fails on cold start under Next.js,
// so we import via the inner module path. Types are not shipped for that
// path, hence this minimal declaration.

declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfData {
    text: string;
    numpages: number;
    info?: Record<string, unknown>;
    metadata?: unknown;
  }
  function pdfParse(
    buffer: Buffer,
    options?: Record<string, unknown>,
  ): Promise<PdfData>;
  export default pdfParse;
}
