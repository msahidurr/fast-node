import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Generated mockups (and their lazily-built template base images) live under
// data/, not public/: public/ is a *build-time* snapshot copied into
// build/client, so anything written there after the app is built wouldn't be
// served in production. app/routes/mockups.$filename.tsx streams these back
// instead (same pattern as the csv-sftp adapter's runtime output directory).
const TEMPLATES_DIR = path.join(process.cwd(), "data", "mockup-templates");
export const MOCKUPS_DIR = path.join(process.cwd(), "data", "mockups");

export interface MockupTemplate {
  key: string;
  label: string;
  width: number;
  height: number;
  printArea: { left: number; top: number; width: number; height: number };
}

// Stand-ins for partner-provided templates (FR-2.3). A real partner
// integration would supply the base image and print-area geometry themselves;
// these are generated locally so the feature works without needing partner
// asset files this project doesn't have.
export const MOCKUP_TEMPLATES: MockupTemplate[] = [
  {
    key: "tote-bag",
    label: "Tote Bag",
    width: 800,
    height: 800,
    printArea: { left: 250, top: 250, width: 300, height: 300 },
  },
  {
    key: "mug",
    label: "Ceramic Mug",
    width: 800,
    height: 600,
    printArea: { left: 290, top: 190, width: 220, height: 220 },
  },
  {
    key: "tshirt",
    label: "T-Shirt",
    width: 800,
    height: 900,
    printArea: { left: 250, top: 220, width: 300, height: 360 },
  },
];

export function getMockupTemplate(key: string): MockupTemplate | undefined {
  return MOCKUP_TEMPLATES.find((template) => template.key === key);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureTemplateImage(template: MockupTemplate): Promise<Buffer> {
  const filePath = path.join(TEMPLATES_DIR, `${template.key}.png`);
  if (await fileExists(filePath)) {
    return readFile(filePath);
  }

  const { printArea } = template;
  const svg = `<svg width="${template.width}" height="${template.height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f1efe9"/>
    <rect x="${printArea.left}" y="${printArea.top}" width="${printArea.width}" height="${printArea.height}"
          fill="#ffffff" stroke="#c9c4b8" stroke-width="4" stroke-dasharray="10 8"/>
  </svg>`;

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  await mkdir(TEMPLATES_DIR, { recursive: true });
  await writeFile(filePath, png);
  return png;
}

export interface GeneratedMockup {
  filename: string;
  url: string;
}

// Composites uploaded artwork onto a template's print area (FR-2.3).
export async function generateMockup(templateKey: string, artwork: Buffer): Promise<GeneratedMockup> {
  const template = getMockupTemplate(templateKey);
  if (!template) {
    throw new Error(`Unknown mockup template: ${templateKey}`);
  }

  const templateImage = await ensureTemplateImage(template);
  const { printArea } = template;

  const resizedArtwork = await sharp(artwork)
    .resize(printArea.width, printArea.height, { fit: "cover" })
    .toBuffer();

  const composited = await sharp(templateImage)
    .composite([{ input: resizedArtwork, left: printArea.left, top: printArea.top }])
    .png()
    .toBuffer();

  await mkdir(MOCKUPS_DIR, { recursive: true });
  const filename = `${randomUUID()}.png`;
  await writeFile(path.join(MOCKUPS_DIR, filename), composited);

  return { filename, url: `/mockups/${filename}` };
}
