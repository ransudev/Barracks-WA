import { z } from "zod";
import { EMAIL_MESSAGE, isValidEmail } from "@/app/utils/contact-validation";
import { optionalPhoneSchema, textSchema } from "@/server/schemas/text.schema";

const money = z.number().finite().min(0).max(9999999999.99);
const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().min(0).max(2147483647);
const phoneSchema = optionalPhoneSchema;
const optionalEmail = z.string().trim().max(320, "Email must be 320 characters or fewer").refine((value) => !value || isValidEmail(value), { message: EMAIL_MESSAGE });

const supplierDetailsShape = {
  companyName: textSchema("Company name", 180, { required: true }),
  contactPerson: textSchema("Contact person", 180).default(""),
  phone: phoneSchema.default(""),
  email: optionalEmail.default(""),
  address: textSchema("Address", 2000, { multiline: true }).default(""),
  notes: textSchema("Notes", 4000, { multiline: true }).default(""),
} as const;

function requireSupplierContact(data: { phone: string; email: string }, ctx: z.RefinementCtx) {
  if (!data.phone && !data.email) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["phone"],
      message: "Provide a phone number or email address",
    });
  }
}

export const supplierSchema = z.object({
  ...supplierDetailsShape,
  status: z.enum(["active", "inactive"]).default("active"),
}).strict().superRefine(requireSupplierContact);

export const supplierProfileUpdateSchema = z.object(supplierDetailsShape)
  .strict()
  .superRefine(requireSupplierContact);

export const supplierAccountSchema = z.object({
  supplierId: positiveInt,
  userId: positiveInt,
}).strict();

const inventoryImage = z.string().trim().max(2000000)
  .refine(
    (value) => !value
      || /^https?:\/\//i.test(value)
      || /^data:image\/(png|jpe?g|webp|gif|avif);base64,/i.test(value)
      || /^\/[A-Za-z0-9._/-]+$/.test(value),
    { message: "Add an image link, local catalog image, or upload a PNG, JPG, or WebP file" },
  )
  .nullable()
  .optional();

const inventoryMetadataShape = {
  name: textSchema("Item name", 160, { required: true }),
  category: z.enum(["Supplies", "Equipment", "Products"]),
  branch: textSchema("Branch", 160, { required: true }).default("Main Branch"),
  supplierId: positiveInt.nullable(),
  unit: textSchema("Unit", 40, { required: true }),
  sku: textSchema("SKU", 100).nullable(),
  imageUrl: inventoryImage,
  minimumStock: nonNegativeInt,
  maximumStock: nonNegativeInt.nullable(),
  unitCost: money,
  status: z.enum(["active", "inactive"]),
} as const;

function maximumStockIsValid(data: { minimumStock: number; maximumStock: number | null }): boolean {
  return data.maximumStock === null || data.maximumStock >= data.minimumStock;
}

export const inventoryMetadataSchema = z.object(inventoryMetadataShape).strict().refine(maximumStockIsValid, {
  path: ["maximumStock"],
  message: "Maximum stock must be at least minimum stock",
});

export const inventoryCreateSchema = z.object({
  ...inventoryMetadataShape,
  initialQuantity: nonNegativeInt.default(0),
}).strict().refine(maximumStockIsValid, {
  path: ["maximumStock"],
  message: "Maximum stock must be at least minimum stock",
});

export const inventoryMovementSchema = z.object({
  movementType: z.enum([
    "RECEIVE",
    "USE",
    "CUSTOMER_PURCHASE",
    "STAFF_USAGE",
    "DAMAGE",
    "DISCARD",
    "RETURN",
    "ADJUSTMENT",
  ]),
  quantity: positiveInt,
  supplierId: positiveInt.nullable().optional(),
  unitCost: money.nullable().optional(),
  reference: textSchema("Reference", 160).nullable().optional(),
  notes: textSchema("Notes", 4000, { multiline: true }).default(""),
  adjustmentDirection: z.enum(["increase", "decrease"]).optional(),
}).strict().superRefine((data, ctx) => {
  if (data.movementType === "ADJUSTMENT" && !data.adjustmentDirection) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["adjustmentDirection"], message: "Adjustment direction is required" });
  }
  if (data.movementType === "ADJUSTMENT" && !data.notes.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["notes"], message: "Adjustment reason is required" });
  }
});

export const restockCreateSchema = z.object({
  supplierId: positiveInt,
  branch: textSchema("Branch", 160, { required: true }).default("Main Branch"),
  reference: textSchema("Reference", 160).nullable().optional(),
  notes: textSchema("Notes", 4000, { multiline: true }).default(""),
  items: z.array(z.object({
    inventoryItemId: positiveInt,
    requestedQuantity: positiveInt,
    unitCost: money.nullable().optional(),
  }).strict()).min(1),
}).strict().superRefine((data, ctx) => {
  const ids = data.items.map((item) => item.inventoryItemId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "An item can only appear once per restock request" });
  }
});

export const restockStatusSchema = z.object({
  status: z.enum(["Pending", "Accepted", "Preparing", "Shipped", "Delivered", "Cancelled"]),
}).strict();

export const receiveRestockSchema = z.object({
  reference: textSchema("Reference", 160).nullable().optional(),
  notes: textSchema("Notes", 4000, { multiline: true }).default(""),
  items: z.array(z.object({
    restockRequestItemId: positiveInt,
    deliveredQuantity: nonNegativeInt,
    unitCost: money.nullable().optional(),
  }).strict()).min(1),
}).strict().superRefine((data, ctx) => {
  const ids = data.items.map((item) => item.restockRequestItemId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "A restock line can only be received once" });
  }
});

export type SupplierInput = z.infer<typeof supplierSchema>;
export type InventoryMetadataInput = z.infer<typeof inventoryMetadataSchema>;
export type InventoryCreateInput = z.infer<typeof inventoryCreateSchema>;
export type InventoryMovementInput = z.infer<typeof inventoryMovementSchema>;
export type RestockCreateInput = z.infer<typeof restockCreateSchema>;
export type RestockStatusInput = z.infer<typeof restockStatusSchema>;
export type ReceiveRestockInput = z.infer<typeof receiveRestockSchema>;
