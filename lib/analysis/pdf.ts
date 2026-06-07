import PDFDocument from "pdfkit";

export interface AnalysisResult {
  student_summary?: string;
  interview_overview?: string;
  scores?: Record<string, number>;
  strengths?: string[];
  growth_areas?: string[];
  key_quotes?: Array<{ quote?: string; approx_time?: string }>;
  follow_up_questions?: string[];
  topics?: string[];
  confidence?: number;
  // Allow any extra fields without losing them on render.
  [key: string]: unknown;
}

export interface RenderInput {
  session: {
    id: string;
    createdAt: string;
    durationMs: number | null;
  };
  model: string;
  promptHash: string;
  result: AnalysisResult;
}

export function renderAnalysisPdf(input: RenderInput): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 54 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);

    try {
      writeReport(doc, input);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function writeReport(doc: PDFKit.PDFDocument, input: RenderInput) {
  const { session, model, promptHash, result } = input;
  const created = new Date(session.createdAt);
  const durStr = session.durationMs
    ? `${Math.round(session.durationMs / 1000)}s`
    : "—";

  // Header
  doc.fontSize(20).font("Helvetica-Bold").text("Academic Counseling Interview");
  doc.fontSize(13).font("Helvetica").fillColor("#444").text("Video analysis report");
  doc.moveDown(0.6);
  doc.fillColor("#000");

  // Metadata block
  doc.fontSize(10).font("Helvetica").fillColor("#444");
  const meta = [
    `Session ID:   ${session.id}`,
    `Recorded:     ${created.toISOString()}`,
    `Duration:     ${durStr}`,
    `Model:        ${model}`,
    `Prompt hash:  ${promptHash}`,
    typeof result.confidence === "number"
      ? `Confidence:   ${result.confidence.toFixed(2)}`
      : null,
  ].filter(Boolean) as string[];
  for (const line of meta) doc.text(line);
  doc.fillColor("#000");
  doc.moveDown(0.8);

  rule(doc);
  doc.moveDown(0.6);

  if (result.student_summary) {
    section(doc, "Student summary", result.student_summary);
  }

  if (result.interview_overview) {
    section(doc, "Interview overview", result.interview_overview);
  }

  if (result.scores && Object.keys(result.scores).length > 0) {
    heading(doc, "Scores");
    const entries = Object.entries(result.scores);
    for (const [key, value] of entries) {
      doc.fontSize(11).font("Helvetica");
      const label = formatLabel(key);
      const bar = "█".repeat(Math.max(0, Math.round(Number(value)))) || "·";
      doc.text(`${label.padEnd(28)} ${value}/5  ${bar}`);
    }
    doc.moveDown(0.6);
  }

  if (Array.isArray(result.strengths) && result.strengths.length > 0) {
    bulletSection(doc, "Strengths", result.strengths);
  }

  if (Array.isArray(result.growth_areas) && result.growth_areas.length > 0) {
    bulletSection(doc, "Growth areas", result.growth_areas);
  }

  if (Array.isArray(result.key_quotes) && result.key_quotes.length > 0) {
    heading(doc, "Key quotes");
    for (const q of result.key_quotes) {
      const t = q.approx_time ? ` (${q.approx_time})` : "";
      doc.fontSize(11).font("Helvetica-Oblique").fillColor("#222");
      doc.text(`“${q.quote ?? ""}”${t}`, { indent: 12 });
      doc.fillColor("#000");
      doc.moveDown(0.2);
    }
    doc.moveDown(0.4);
  }

  if (
    Array.isArray(result.follow_up_questions) &&
    result.follow_up_questions.length > 0
  ) {
    bulletSection(doc, "Follow-up questions", result.follow_up_questions);
  }

  if (Array.isArray(result.topics) && result.topics.length > 0) {
    heading(doc, "Topics");
    doc.fontSize(11).font("Helvetica").text(result.topics.join("  ·  "));
    doc.moveDown(0.6);
  }

  // Footer with full raw JSON for traceability — small font, last page.
  doc.addPage();
  doc.fontSize(11).font("Helvetica-Bold").text("Appendix: raw model output");
  doc.moveDown(0.4);
  doc.fontSize(8).font("Courier").fillColor("#222");
  doc.text(JSON.stringify(result, null, 2), { lineGap: 1 });
}

function heading(doc: PDFKit.PDFDocument, label: string) {
  doc.moveDown(0.4);
  doc.fontSize(13).font("Helvetica-Bold").fillColor("#000").text(label);
  doc.moveDown(0.2);
}

function section(doc: PDFKit.PDFDocument, label: string, body: string) {
  heading(doc, label);
  doc.fontSize(11).font("Helvetica").fillColor("#000").text(body, {
    align: "left",
    lineGap: 2,
  });
  doc.moveDown(0.6);
}

function bulletSection(
  doc: PDFKit.PDFDocument,
  label: string,
  items: string[],
) {
  heading(doc, label);
  doc.fontSize(11).font("Helvetica");
  for (const item of items) {
    doc.text(`•  ${item}`, { indent: 8, lineGap: 2 });
    doc.moveDown(0.1);
  }
  doc.moveDown(0.4);
}

function rule(doc: PDFKit.PDFDocument) {
  const y = doc.y;
  doc
    .strokeColor("#ccc")
    .lineWidth(0.5)
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .stroke()
    .strokeColor("#000");
}

function formatLabel(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
