import PDFDocument from "pdfkit";
import type { Database } from "@repo/db";

/**
 * Member directory -> a printable PDF roster (Buffer). Unlike the CSV export
 * (every column, for data), the PDF shows a reduced, readable column set in a
 * simple table with a header that repeats on each page. Uses pdfkit's built-in
 * Helvetica (no font files to ship). Pure given its inputs aside from the
 * generation timestamp.
 */

type MemberRow = Database["public"]["Tables"]["members"]["Row"];

function displayName(m: MemberRow): string {
  return m.preferred_name || [m.first_name, m.last_name].filter(Boolean).join(" ") || m.first_name;
}

const COLUMNS: { header: string; width: number; value: (m: MemberRow) => string }[] = [
  { header: "Name", width: 150, value: displayName },
  { header: "Email", width: 160, value: (m) => m.email ?? "" },
  { header: "Phone", width: 95, value: (m) => m.phone ?? "" },
  { header: "Status", width: 70, value: (m) => m.status },
  { header: "City", width: 100, value: (m) => m.city ?? "" },
  { header: "Joined", width: 70, value: (m) => m.joined_at ?? "" },
];

const ROW_HEIGHT = 18;

/** Render members as a PDF roster, resolving to the complete file Buffer. */
export function membersToPdf(members: MemberRow[], opts?: { title?: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const startX = doc.page.margins.left;
    const bottom = doc.page.height - doc.page.margins.bottom;

    const drawHeaderRow = (y: number): void => {
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#000000");
      let x = startX;
      for (const col of COLUMNS) {
        doc.text(col.header, x, y, { width: col.width, ellipsis: true });
        x += col.width;
      }
      doc
        .moveTo(startX, y + ROW_HEIGHT - 5)
        .lineTo(x, y + ROW_HEIGHT - 5)
        .strokeColor("#cccccc")
        .stroke();
      doc.font("Helvetica").fillColor("#222222");
    };

    doc.font("Helvetica-Bold").fontSize(16).fillColor("#111111").text(opts?.title ?? "Member Directory");
    doc.moveDown(0.3);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#666666")
      .text(`Generated ${new Date().toISOString().slice(0, 10)} · ${members.length} member(s)`);
    doc.moveDown(0.7);

    let y = doc.y;
    drawHeaderRow(y);
    y += ROW_HEIGHT;

    doc.fontSize(9).fillColor("#222222");
    for (const m of members) {
      if (y + ROW_HEIGHT > bottom) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeaderRow(y);
        y += ROW_HEIGHT;
      }
      let x = startX;
      for (const col of COLUMNS) {
        doc.text(col.value(m) || "", x, y, { width: col.width, ellipsis: true });
        x += col.width;
      }
      y += ROW_HEIGHT;
    }

    doc.end();
  });
}
