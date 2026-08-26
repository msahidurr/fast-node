import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll } from "vitest";
import { csvSftpAdapter } from "./csv-sftp.adapter";
import { describePartnerAdapterContract } from "../testing/adapter-contract";

describePartnerAdapterContract(csvSftpAdapter, {
  category: "pet-products",
  region: "US",
  knownSku: "PET-BOWL-CER-S",
  unknownSku: "DOES-NOT-EXIST",
});

// This adapter simulates its SFTP outbound drop with real files on disk;
// clean up what the contract tests wrote so repeated runs stay idempotent.
afterAll(async () => {
  await rm(path.join(process.cwd(), "data", "partners", "csv-sftp", "outbound"), {
    recursive: true,
    force: true,
  });
});
