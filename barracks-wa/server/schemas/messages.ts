import { z } from "zod";

// Plain-language fallback messages for every schema. A message written on a
// schema still wins; this only replaces Zod's generic text such as
// "Too big: expected string to have <=100 characters", which names no field.

const LABELS: Record<string, string> = {
  sku: "SKU",
  id: "ID",
  imageUrl: "Image",
  amountCentavos: "Amount",
  idempotencyKey: "Request key",
};

// "firstName" -> "First name"; array positions use the field that holds them.
export function fieldLabel(path: readonly PropertyKey[]): string {
  const key = [...path].reverse().find((part): part is string => typeof part === "string");
  if (!key) return "This value";
  if (LABELS[key]) return LABELS[key];
  const words = key.replace(/Id$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const FORMATS: Record<string, string> = {
  date: "a valid date (YYYY-MM-DD)",
  datetime: "a valid date and time",
  time: "a valid time",
  uuid: "a valid ID",
  email: "a valid email address",
  url: "a valid web address",
};

z.config({
  customError: (issue) => {
    const label = fieldLabel(issue.path ?? []);
    switch (issue.code) {
      case "invalid_type":
        if (issue.input === undefined || issue.input === null) return `${label} is required`;
        if (issue.expected === "int") return `${label} must be a whole number`;
        if (issue.expected === "number") return `${label} must be a number`;
        if (issue.expected === "string") return `${label} must be text`;
        if (issue.expected === "boolean") return `${label} must be yes or no`;
        return `${label} is invalid`;
      case "too_small":
        if (issue.origin === "string")
          return Number(issue.minimum) <= 1 ? `${label} is required` : `${label} must be at least ${issue.minimum} characters`;
        if (issue.origin === "array") return Number(issue.minimum) <= 1 ? `Add at least one ${label.toLowerCase()}` : `${label} needs at least ${issue.minimum} entries`;
        if (issue.origin === "number" || issue.origin === "int")
          return Number(issue.minimum) === 0 && !issue.inclusive ? `${label} must be greater than 0` : `${label} must be at least ${issue.minimum}`;
        return `${label} is too small`;
      case "too_big":
        if (issue.origin === "string") return `${label} must be ${issue.maximum} characters or fewer`;
        if (issue.origin === "array") return `${label} can have at most ${issue.maximum} entries`;
        if (issue.origin === "number" || issue.origin === "int") return `${label} must be at most ${issue.maximum}`;
        return `${label} is too large`;
      case "invalid_format":
        return FORMATS[issue.format] ? `${label} must be ${FORMATS[issue.format]}` : `${label} contains characters that are not allowed`;
      case "invalid_value":
        return `Choose a valid ${label.toLowerCase()}`;
      case "not_multiple_of":
        return `${label} has too many decimal places`;
      case "unrecognized_keys":
        return `Unexpected field${issue.keys.length === 1 ? "" : "s"}: ${issue.keys.join(", ")}`;
      case "invalid_union":
        return `${label} is invalid`;
      default:
        return undefined;
    }
  },
});
