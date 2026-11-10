import { createHash } from "node:crypto";
export const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
