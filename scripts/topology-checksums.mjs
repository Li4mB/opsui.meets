import crypto from "node:crypto";

export function buildTopologyChecksums(files) {
  return files
    .map(({ name, content }) => {
      const hash = crypto.createHash("sha256").update(content, "utf8").digest("hex");
      return `${hash}  ${name}`;
    })
    .join("\n")
    .concat("\n");
}
