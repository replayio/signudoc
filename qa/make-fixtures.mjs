// Writes the PDF fixtures QA agents upload, under public/qa/. The small
// ones are committed; the oversized one is made at build time because it
// is 21 MB of random bytes. Run: node qa/make-fixtures.mjs [--oversized-only]
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument, StandardFonts, degrees } from "pdf-lib";

const outDir = path.join(process.cwd(), "public", "qa");
const oversizedOnly = process.argv.includes("--oversized-only");

async function withText(document, page, text) {
  const font = await document.embedFont(StandardFonts.Helvetica);

  page.drawText(text, { font, size: 16, x: 48, y: page.getHeight() - 64 });
  page.drawText("Signature: ______________________", {
    font,
    size: 12,
    x: 48,
    y: 96,
  });
}

async function makeLong() {
  const document = await PDFDocument.create();
  const sizes = [
    [612, 792], // US Letter
    [595, 842], // A4
    [842, 595], // A4 landscape
    [420, 595], // A5
  ];

  for (let pageNumber = 1; pageNumber <= 30; pageNumber += 1) {
    const [width, height] = sizes[(pageNumber - 1) % sizes.length];
    const page = document.addPage([width, height]);

    if (pageNumber % 7 === 0) {
      page.setRotation(degrees(90));
    }

    await withText(document, page, `Long agreement, page ${pageNumber} of 30`);
  }

  return document.save();
}

async function makeOversized() {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);

  await withText(document, page, "Oversized agreement (over the 20 MB limit)");
  // Random bytes do not compress, so the file stays over the limit.
  await document.attach(randomBytes(21 * 1024 * 1024), "padding.bin", {
    mimeType: "application/octet-stream",
  });

  return document.save();
}

await mkdir(outDir, { recursive: true });

if (!oversizedOnly) {
  await writeFile(path.join(outDir, "long.pdf"), await makeLong());
}

await writeFile(path.join(outDir, "oversized.pdf"), await makeOversized());
console.log(`fixtures written to ${outDir}`);
