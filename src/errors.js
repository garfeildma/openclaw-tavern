import { RP_ERROR_CODES } from "./types.js";

export class RPError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = "RPError";
    this.code = code || RP_ERROR_CODES.INTERNAL_ERROR;
    this.data = data || {};
  }

  toResponse() {
    return {
      ok: false,
      code: this.code,
      message: this.message,
      data: this.data,
    };
  }
}

export function ok(message, data = {}) {
  return {
    ok: true,
    code: RP_ERROR_CODES.OK,
    message,
    data,
  };
}

export function asRPError(err) {
  if (err instanceof RPError) {
    return err;
  }
  return new RPError(RP_ERROR_CODES.INTERNAL_ERROR, err?.message || "Internal error");
}
