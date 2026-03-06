import { RPError } from "../errors.js";
import { RP_ERROR_CODES } from "../types.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function extractCharaJsonFromPng(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new RPError(RP_ERROR_CODES.PARSE_FAILED, "PNG payload must be a Buffer");
  }
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new RPError(RP_ERROR_CODES.PARSE_FAILED, "Invalid PNG signature");
  }

  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (dataEnd + 4 > buffer.length) {
      break;
    }

    if (type === "tEXt") {
      const chunk = buffer.subarray(dataStart, dataEnd);
      const separator = chunk.indexOf(0x00);
      if (separator > 0) {
        const keyword = chunk.subarray(0, separator).toString("utf8");
        if (keyword === "chara") {
          const encoded = chunk.subarray(separator + 1).toString("utf8").trim();
          let decoded;
          try {
            decoded = Buffer.from(encoded, "base64").toString("utf8");
          } catch {
            throw new RPError(RP_ERROR_CODES.PARSE_FAILED, "Failed to decode chara base64 payload");
          }

          try {
            return JSON.parse(decoded);
          } catch {
            throw new RPError(RP_ERROR_CODES.PARSE_FAILED, "Failed to parse chara JSON payload");
          }
        }
      }
    }

    offset = dataEnd + 4;
  }

  throw new RPError(RP_ERROR_CODES.PARSE_FAILED, "PNG has no chara tEXt chunk");
}
