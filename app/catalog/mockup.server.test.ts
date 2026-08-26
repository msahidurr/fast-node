import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { generateMockup, getMockupTemplate, MOCKUPS_DIR } from "./mockup.server";

describe("generateMockup", () => {
  afterAll(async () => {
    await rm(MOCKUPS_DIR, { recursive: true, force: true });
    await rm(path.join(process.cwd(), "data", "mockup-templates"), { recursive: true, force: true });
  });

  it("composites artwork onto a known template and writes a PNG sized to the template", async () => {
    const artwork = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } },
    })
      .png()
      .toBuffer();

    const result = await generateMockup("tote-bag", artwork);

    expect(result.filename).toMatch(/\.png$/);
    expect(result.url).toBe(`/mockups/${result.filename}`);

    const template = getMockupTemplate("tote-bag");
    const metadata = await sharp(path.join(MOCKUPS_DIR, result.filename)).metadata();
    expect(metadata.width).toBe(template?.width);
    expect(metadata.height).toBe(template?.height);
  });

  it("throws for an unknown template", async () => {
    await expect(generateMockup("does-not-exist", Buffer.from(""))).rejects.toThrow(/Unknown mockup template/);
  });
});
