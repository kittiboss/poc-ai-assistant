import { parseCsv } from "./workspace";

/** Columns of the supplied products schema (apps/api/prisma/data/schema.sql). */
export const PRODUCT_COLUMNS = [
  "product_id",
  "sku",
  "name",
  "description",
  "category",
  "subcategory",
  "brand",
  "price",
  "cost_price",
  "currency",
  "stock_quantity",
  "weight_kg",
  "color",
  "material",
  "rating",
  "review_count",
  "is_active",
  "created_at",
  "updated_at",
] as const;

/** Decimals stay strings end to end so DECIMAL columns never pass through floating point. */
export type ProductRecord = {
  productId: number;
  sku: string;
  name: string;
  description: string;
  category: string;
  subcategory: string;
  brand: string;
  price: string;
  costPrice: string;
  currency: string;
  stockQuantity: number;
  weightKg: string | null;
  color: string | null;
  material: string | null;
  rating: string | null;
  reviewCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export class ProductCsvError extends Error {
  constructor(readonly errors: string[]) {
    super(
      `The CSV has ${errors.length === 1 ? "an error" : `${errors.length} errors`}: ${errors.slice(0, 5).join("; ")}`,
    );
  }
}

const MAX_ERRORS = 20;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

/**
 * Parses and validates a products CSV against the schema. The whole file is rejected
 * on any error so an import never leaves the catalog half-updated.
 */
export function parseProductCsv(text: string): ProductRecord[] {
  let rows: string[][];
  try {
    rows = parseCsv(text).filter((row) =>
      row.some((cell) => cell.trim() !== ""),
    );
  } catch (error) {
    throw new ProductCsvError([(error as Error).message]);
  }
  const header = (rows.shift() || []).map((cell) => cell.trim().toLowerCase());
  const missing = PRODUCT_COLUMNS.filter((column) => !header.includes(column));
  const unknown = header.filter(
    (column) => !(PRODUCT_COLUMNS as readonly string[]).includes(column),
  );
  if (missing.length || unknown.length)
    throw new ProductCsvError([
      ...(missing.length ? [`missing column(s): ${missing.join(", ")}`] : []),
      ...(unknown.length ? [`unknown column(s): ${unknown.join(", ")}`] : []),
    ]);
  if (!rows.length) throw new ProductCsvError(["the file has no product rows"]);

  const errors: string[] = [];
  const products: ProductRecord[] = [];
  const ids = new Set<number>();
  const skus = new Set<string>();
  rows.forEach((row, index) => {
    if (errors.length >= MAX_ERRORS) return;
    const cell = (column: (typeof PRODUCT_COLUMNS)[number]) =>
      (row[header.indexOf(column)] ?? "").trim();
    const problems: string[] = [];
    const text = (
      column: (typeof PRODUCT_COLUMNS)[number],
      max: number,
      required = true,
    ) => {
      const value = cell(column);
      if (!value) {
        if (required) problems.push(`${column} is required`);
        return null;
      }
      if (value.length > max)
        problems.push(`${column} exceeds ${max} characters`);
      return value;
    };
    const integer = (
      column: (typeof PRODUCT_COLUMNS)[number],
      fallback?: number,
    ) => {
      const value = cell(column);
      if (!value && fallback !== undefined) return fallback;
      if (!/^\d+$/.test(value) || Number(value) > 2_147_483_647) {
        problems.push(`${column} must be a non-negative whole number`);
        return 0;
      }
      return Number(value);
    };
    const decimal = (
      column: (typeof PRODUCT_COLUMNS)[number],
      digits: number,
      required = true,
    ) => {
      const value = cell(column);
      if (!value) {
        if (required) problems.push(`${column} is required`);
        return null;
      }
      if (!new RegExp(`^\\d{1,${digits}}(\\.\\d{1,2})?$`).test(value))
        problems.push(
          `${column} must be a non-negative decimal with up to 2 places`,
        );
      return value;
    };
    const timestamp = (column: (typeof PRODUCT_COLUMNS)[number]) => {
      const match = TIMESTAMP.exec(cell(column));
      // TIMESTAMP columns have no time zone; values are stored as written.
      const date = match
        ? new Date(
            Date.UTC(
              +match[1],
              +match[2] - 1,
              +match[3],
              +match[4],
              +match[5],
              +match[6],
            ),
          )
        : null;
      if (
        !date ||
        date.toISOString().slice(0, 19).replace("T", " ") !==
          cell(column).replace("T", " ")
      ) {
        problems.push(`${column} must be a timestamp like 2025-03-08 03:42:04`);
        return new Date(0);
      }
      return date;
    };

    const productId = integer("product_id");
    if (productId < 1 && /^\d+$/.test(cell("product_id")))
      problems.push("product_id must be at least 1");
    const rating = decimal("rating", 1, false);
    if (rating !== null && Number(rating) > 5)
      problems.push("rating must be between 0 and 5");
    const currency = cell("currency").toUpperCase() || "USD";
    if (!/^[A-Z]{3}$/.test(currency))
      problems.push("currency must be a 3-letter code");
    const active = cell("is_active").toLowerCase();
    if (!["true", "false", "1", "0"].includes(active))
      problems.push("is_active must be true or false");

    const product: ProductRecord = {
      productId,
      sku: text("sku", 20) || "",
      name: text("name", 150) || "",
      description: text("description", 100_000) || "",
      category: text("category", 50) || "",
      subcategory: text("subcategory", 50) || "",
      brand: text("brand", 50) || "",
      price: decimal("price", 8) || "0",
      costPrice: decimal("cost_price", 8) || "0",
      currency,
      stockQuantity: integer("stock_quantity", 0),
      weightKg: decimal("weight_kg", 6, false),
      color: text("color", 50, false),
      material: text("material", 100, false),
      rating,
      reviewCount: integer("review_count", 0),
      isActive: active === "true" || active === "1",
      createdAt: timestamp("created_at"),
      updatedAt: timestamp("updated_at"),
    };
    if (ids.has(productId)) problems.push(`duplicate product_id ${productId}`);
    if (product.sku && skus.has(product.sku))
      problems.push(`duplicate sku ${product.sku}`);
    ids.add(productId);
    skus.add(product.sku);
    if (problems.length)
      errors.push(
        `row ${index + 1}${productId ? ` (product_id ${productId})` : ""}: ${problems.join(", ")}`,
      );
    else products.push(product);
  });
  if (errors.length) throw new ProductCsvError(errors);
  return products;
}

type PassageInput = Omit<
  ProductRecord,
  "price" | "costPrice" | "weightKg" | "rating" | "createdAt" | "updatedAt"
> & {
  price: { toString(): string };
  costPrice: { toString(): string };
  weightKg: { toString(): string } | null;
  rating: { toString(): string } | null;
};

/** The text a product is retrieved by and shown to the model as. Stock and status are spelled out so they match natural questions. */
export function productPassage(product: PassageInput) {
  const money = (value: { toString(): string }) =>
    `${Number(value.toString()).toFixed(2)} ${product.currency}`;
  const details = [
    product.color && `Color: ${product.color}`,
    product.material && `Material: ${product.material}`,
    product.weightKg !== null && `Weight: ${product.weightKg.toString()} kg`,
  ].filter(Boolean);
  const title = `${product.name} (${product.sku})`;
  const text = [
    `Product: ${product.name}`,
    `SKU: ${product.sku}`,
    `Brand: ${product.brand}`,
    `Category: ${product.category} > ${product.subcategory}`,
    `Price: ${money(product.price)}`,
    `Cost price: ${money(product.costPrice)}`,
    `Stock: ${product.stockQuantity} units${product.stockQuantity === 0 ? " (out of stock)" : ""}`,
    `Status: ${product.isActive ? "active (on sale)" : "inactive (not on sale)"}`,
    `Rating: ${product.rating !== null ? `${product.rating.toString()} out of 5 from ${product.reviewCount} reviews` : "not rated yet"}`,
    ...details,
    `Description: ${product.description}`,
  ].join("\n");
  return { title, text };
}
