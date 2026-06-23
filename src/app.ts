const PDFJS_WORKER_URL = "./vendor/pdfjs/pdf.worker.min.js";

type CsvValue = string | number;

interface AppState {
  csv: string;
  downloadName: string;
  rows: StatementRow[];
  objectUrl: string;
}

interface Elements {
  fileInput: HTMLInputElement;
  pickButton: HTMLButtonElement;
  dropzone: HTMLElement;
  message: HTMLElement;
  resultSection: HTMLElement;
  summary: HTMLElement;
  rows: HTMLTableSectionElement;
  downloadButton: HTMLButtonElement;
}

interface TextItem {
  str: string;
  transform: number[];
}

interface TextContent {
  items: TextItem[];
}

interface PdfPage {
  getTextContent(): Promise<TextContent>;
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}

interface PdfJsLib {
  GlobalWorkerOptions: {
    workerSrc: string;
  };
  getDocument(options: { data: Uint8Array; disableWorker?: boolean }): {
    promise: Promise<PdfDocument>;
  };
}

interface PositionedText {
  text: string;
  x: number;
  y: number;
}

interface TextGroup {
  y: number;
  items: PositionedText[];
}

type ColumnKey =
  | "month"
  | "day"
  | "type1"
  | "station1"
  | "type2"
  | "station2"
  | "balance"
  | "amount";

type Columns = Record<ColumnKey, string[]>;

interface StatementRow {
  month: string;
  day: string;
  type1: string;
  station1: string;
  type2: string;
  station2: string;
  balance: number;
  amount: number | "";
  raw: string;
}

declare global {
  interface Window {
    pdfjsLib?: PdfJsLib;
    "pdfjs-dist/build/pdf"?: PdfJsLib;
  }
}

const state: AppState = {
  csv: "",
  downloadName: "suica.csv",
  rows: [],
  objectUrl: "",
};

const elements: Elements = {
  fileInput: requiredElement("#fileInput", HTMLInputElement),
  pickButton: requiredElement("#pickButton", HTMLButtonElement),
  dropzone: requiredElement("#dropzone", HTMLElement),
  message: requiredElement("#message", HTMLElement),
  resultSection: requiredElement("#resultSection", HTMLElement),
  summary: requiredElement("#summary", HTMLElement),
  rows: requiredElement("#rows", HTMLTableSectionElement),
  downloadButton: requiredElement("#downloadButton", HTMLButtonElement),
};

elements.pickButton.addEventListener("click", () => elements.fileInput.click());

elements.fileInput.addEventListener("change", () => {
  const file = elements.fileInput.files?.[0];
  if (file) void convertFile(file);
});

elements.dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.dropzone.classList.add("is-dragging");
});

elements.dropzone.addEventListener("dragleave", () => {
  elements.dropzone.classList.remove("is-dragging");
});

elements.dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.dropzone.classList.remove("is-dragging");
  const file = [...event.dataTransfer?.files ?? []].find((item) => item.type === "application/pdf");
  if (file) void convertFile(file);
});

elements.downloadButton.addEventListener("click", () => {
  if (!state.csv) return;
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  const blob = new Blob([state.csv], { type: "text/csv;charset=utf-8" });
  state.objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = state.objectUrl;
  link.download = state.downloadName;
  link.click();
});

async function convertFile(file: File): Promise<void> {
  resetOutput();
  setMessage(`${file.name} を解析中`);

  try {
    const pdfjs = getPdfJs();
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await loadPdf(pdfjs, bytes);
    const lines: StatementRow[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      lines.push(...textItemsToRows(content.items));
    }

    const rows = lines.filter(Boolean);
    if (!rows.length) {
      throw new Error("Suica明細行を検出できませんでした。");
    }

    state.rows = rows;
    state.csv = toCsv(rows);
    state.downloadName = csvNameFromPdf(file.name);
    renderRows(rows);
    elements.summary.textContent = `${file.name} / ${rows.length}件`;
    elements.resultSection.classList.remove("is-empty");
    elements.downloadButton.disabled = false;
    setMessage("変換済み");
  } catch (error) {
    console.error(error);
    renderError(error instanceof Error ? error.message : "変換に失敗しました。");
    elements.resultSection.classList.remove("is-empty");
    setMessage("変換に失敗しました");
  }
}

function getPdfJs(): PdfJsLib {
  const pdfjs = window.pdfjsLib ?? window["pdfjs-dist/build/pdf"];
  if (!pdfjs) {
    throw new Error("PDF.jsを読み込めませんでした。");
  }
  return pdfjs;
}

async function loadPdf(pdfjs: PdfJsLib, bytes: Uint8Array): Promise<PdfDocument> {
  try {
    return await pdfjs.getDocument({ data: bytes.slice() }).promise;
  } catch (error) {
    console.warn("PDF.js worker failed. Retrying with the built-in fallback.", error);
    return pdfjs.getDocument({ data: bytes.slice(), disableWorker: true }).promise;
  }
}

function textItemsToRows(items: TextItem[]): StatementRow[] {
  const candidates = items
    .map((item) => {
      const [, , , , x, y] = item.transform;
      return {
        text: normalizeText(item.str),
        x,
        y,
      };
    })
    .filter((item): item is PositionedText => Boolean(item.text) && item.text !== "*");

  const groups: TextGroup[] = [];
  for (const item of candidates) {
    const group = groups.find((entry) => Math.abs(entry.y - item.y) < 3);
    if (group) {
      group.items.push(item);
      group.y = (group.y + item.y) / 2;
    } else {
      groups.push({ y: item.y, items: [item] });
    }
  }

  return groups
    .sort((a, b) => b.y - a.y)
    .map(groupToRow)
    .filter((row): row is StatementRow => Boolean(row));
}

function groupToRow(group: TextGroup): StatementRow | null {
  const columns: Columns = {
    month: [],
    day: [],
    type1: [],
    station1: [],
    type2: [],
    station2: [],
    balance: [],
    amount: [],
  };

  for (const item of group.items.sort((a, b) => a.x - b.x)) {
    const key = columnForX(item.x);
    if (key) columns[key].push(item.text);
  }

  const balance = parseCurrency(joinColumn(columns.balance));
  const row: StatementRow = {
    month: joinColumn(columns.month),
    day: joinColumn(columns.day),
    type1: joinColumn(columns.type1),
    station1: joinColumn(columns.station1),
    type2: joinColumn(columns.type2),
    station2: joinColumn(columns.station2),
    balance,
    amount: parseSignedCurrency(joinColumn(columns.amount)),
    raw: group.items
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  };

  if (!/^\d{2}$/.test(row.month) || !/^\d{2}$/.test(row.day) || balance === 0 && !joinColumn(columns.balance)) {
    return null;
  }

  return row;
}

function columnForX(x: number): ColumnKey | "" {
  if (x >= 145 && x < 176) return "month";
  if (x >= 176 && x < 206) return "day";
  if (x >= 206 && x < 246) return "type1";
  if (x >= 246 && x < 316) return "station1";
  if (x >= 316 && x < 366) return "type2";
  if (x >= 366 && x < 426) return "station2";
  if (x >= 426 && x < 486) return "balance";
  if (x >= 486) return "amount";
  return "";
}

function joinColumn(values: string[]): string {
  return values.map(normalizeText).join("").trim();
}

function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/￥/g, "\\")
    .replace(/\u3000/g, " ")
    .trim();
}

function parseSignedCurrency(value: string): number | "" {
  const normalized = normalizeText(value).replace(/[¥\\,]/g, "");
  return /^[+-]?\d+$/.test(normalized) ? Number(normalized) : "";
}

function parseCurrency(value: string): number {
  const normalized = normalizeText(value).replace(/[¥\\,]/g, "");
  return /^\d+$/.test(normalized) ? Number(normalized) : 0;
}

function toCsv(rows: StatementRow[]): string {
  const header: Array<keyof StatementRow> = [
    "month",
    "day",
    "type1",
    "station1",
    "type2",
    "station2",
    "balance",
    "amount",
    "raw",
  ];
  const body = rows.map((row) => header.map((key) => escapeCsv(row[key])).join(","));
  return "\uFEFF" + [header.join(","), ...body].join("\n");
}

function escapeCsv(value: CsvValue): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvNameFromPdf(filename: string): string {
  const trimmed = filename.trim() || "suica.pdf";
  const basename = trimmed.replace(/\.[^.\\/]+$/, "");
  return `${basename || "suica"}.csv`;
}

function renderRows(rows: StatementRow[]): void {
  elements.rows.replaceChildren(
    ...rows.map((row) => {
      const tr = document.createElement("tr");
      tr.append(
        cell(row.month),
        cell(row.day),
        cell(row.type1),
        cell(row.station1),
        cell(row.type2),
        cell(row.station2),
        cell(formatAmount(row.balance), "balance"),
        cell(formatAmount(row.amount), "amount"),
      );
      return tr;
    }),
  );
}

function renderError(message: string): void {
  const tr = document.createElement("tr");
  const td = cell(message);
  td.colSpan = 8;
  td.className = "empty";
  tr.append(td);
  elements.rows.replaceChildren(tr);
}

function renderEmpty(): void {
  const tr = document.createElement("tr");
  const td = cell("PDFを選択すると明細が表示されます。");
  td.colSpan = 8;
  td.className = "empty";
  tr.append(td);
  elements.rows.replaceChildren(tr);
}

function cell(value: CsvValue, className = ""): HTMLTableCellElement {
  const td = document.createElement("td");
  td.textContent = String(value);
  if (className) td.className = className;
  return td;
}

function formatAmount(value: number | ""): string {
  if (value === "") return "";
  return new Intl.NumberFormat("ja-JP").format(value);
}

function setMessage(text: string): void {
  elements.message.textContent = text;
}

function resetOutput(): void {
  state.csv = "";
  state.downloadName = "suica.csv";
  state.rows = [];
  setMessage("PDFを選択");
  elements.summary.textContent = "";
  elements.resultSection.classList.add("is-empty");
  renderEmpty();
  elements.downloadButton.disabled = true;
}

function requiredElement<T extends HTMLElement>(
  selector: string,
  constructor: { new (...args: never[]): T },
): T {
  const element = document.querySelector(selector);
  if (!(element instanceof constructor)) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

export {};
