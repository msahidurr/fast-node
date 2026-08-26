import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CatalogItem,
  CreateOrderPayload,
  CreateOrderResult,
  DisputeResult,
  InventoryStatus,
  OrderStatusResult,
  PartnerAdapter,
} from "../types";

// Reference adapter for a niche partner with no API -- only a catalog dropped
// via SFTP and an outbound directory it picks orders up from (per the SRS's
// Constraints/Risks: "niche partners lack robust APIs"). This simulates that
// with local files; a real integration would poll/put over actual SFTP instead
// of node:fs, but the PartnerAdapter contract -- and everything outside
// app/partners/ -- stays identical either way (NFR-8).
const BASE_DIR = path.join(process.cwd(), "data", "partners", "csv-sftp");
const CATALOG_PATH = path.join(BASE_DIR, "catalog.csv");
const OUTBOUND_DIR = path.join(BASE_DIR, "outbound");
const ORDERS_PATH = path.join(OUTBOUND_DIR, "orders.csv");
const DISPUTES_PATH = path.join(OUTBOUND_DIR, "disputes.csv");

interface CatalogRow {
  sku: string;
  name: string;
  category: string;
  region: string;
  basePrice: number;
  variantOption: string;
  variantValue: string;
  quantity: number;
}

function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function appendCsvRow(filePath: string, header: string[], row: string[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  let needsHeader = false;
  try {
    await readFile(filePath);
  } catch {
    needsHeader = true;
  }
  const line = row.map(csvField).join(",") + "\n";
  const content = needsHeader ? header.join(",") + "\n" + line : line;
  await writeFile(filePath, content, { flag: "a" });
}

async function readCatalog(): Promise<CatalogRow[]> {
  const raw = await readFile(CATALOG_PATH, "utf8");
  const [, ...lines] = raw.trim().split("\n");
  return lines
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sku, name, category, region, basePrice, variantOption, variantValue, quantity] = line.split(",");
      return {
        sku,
        name,
        category,
        region,
        basePrice: Number(basePrice),
        variantOption,
        variantValue,
        quantity: Number(quantity),
      };
    });
}

export const csvSftpAdapter: PartnerAdapter = {
  partnerKey: "csv-sftp",

  async getCatalog(category: string, region: string): Promise<CatalogItem[]> {
    const rows = await readCatalog();
    return rows
      .filter((row) => row.category === category && row.region === region)
      .map((row) => ({
        sku: row.sku,
        name: row.name,
        category: row.category,
        region: row.region,
        basePrice: row.basePrice,
        variants: [{ option: row.variantOption, value: row.variantValue }],
      }));
  },

  async getInventory(sku: string): Promise<InventoryStatus> {
    const rows = await readCatalog();
    const row = rows.find((r) => r.sku === sku);
    return { sku, available: (row?.quantity ?? 0) > 0, quantity: row?.quantity ?? null };
  },

  async createOrder(payload: CreateOrderPayload): Promise<CreateOrderResult> {
    const partnerOrderId = `SFTP-${Date.now()}-${randomUUID().slice(0, 8)}`;
    await appendCsvRow(
      ORDERS_PATH,
      ["partnerOrderId", "shopifyOrderId", "lineItems", "shippingAddress"],
      [partnerOrderId, payload.shopifyOrderId, JSON.stringify(payload.lineItems), JSON.stringify(payload.shippingAddress)],
    );
    return { partnerOrderId };
  },

  async getOrderStatus(partnerOrderId: string): Promise<OrderStatusResult> {
    let raw: string;
    try {
      raw = await readFile(ORDERS_PATH, "utf8");
    } catch {
      throw new Error(`Unknown csv-sftp partner order id: ${partnerOrderId}`);
    }
    if (!raw.includes(partnerOrderId)) {
      throw new Error(`Unknown csv-sftp partner order id: ${partnerOrderId}`);
    }
    // A real integration would report status via a separate inbound drop that
    // gets polled; this reference adapter has no such feed, so a submitted
    // order simply stays QUEUED until that's built.
    return { status: "QUEUED" };
  },

  async submitDispute(orderId: string, type: string, details: string): Promise<DisputeResult> {
    const partnerDisputeId = `SFTP-DSP-${Date.now()}-${randomUUID().slice(0, 8)}`;
    await appendCsvRow(
      DISPUTES_PATH,
      ["partnerDisputeId", "orderId", "type", "details", "status"],
      [partnerDisputeId, orderId, type, details, "OPEN"],
    );
    return { partnerDisputeId, status: "OPEN" };
  },
};
