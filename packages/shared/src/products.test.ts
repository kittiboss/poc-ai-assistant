import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRODUCT_COLUMNS,
  ProductCsvError,
  parseProductCsv,
  productPassage,
} from "./products";

// Tests run from packages/shared.
const bundled = readFileSync(
  resolve(process.cwd(), "../../apps/api/prisma/data/products.csv"),
  "utf8",
);
const header = PRODUCT_COLUMNS.join(",");
const row = (overrides: Record<string, string> = {}) =>
  PRODUCT_COLUMNS.map(
    (column) =>
      ({
        product_id: "1",
        sku: "ELC-0001",
        name: "Test Earbuds",
        description: '"Rich sound, small case."',
        category: "Electronics",
        subcategory: "Audio",
        brand: "SonicWave",
        price: "49.49",
        cost_price: "21.40",
        currency: "USD",
        stock_quantity: "0",
        weight_kg: "0.07",
        color: "Black",
        material: "ABS Plastic",
        rating: "4.1",
        review_count: "201",
        is_active: "true",
        created_at: "2025-03-08 03:42:04",
        updated_at: "2025-03-13 04:50:48",
        ...overrides,
      })[column],
  ).join(",");
const errorsOf = (text: string) => {
  try {
    parseProductCsv(text);
  } catch (error) {
    return (error as ProductCsvError).errors;
  }
  return [];
};

describe("product catalog CSV", () => {
  it("parses the supplied catalog exactly, keeping decimals as strings", () => {
    const products = parseProductCsv(bundled);
    expect(products).toHaveLength(200);
    expect(products[0]).toMatchObject({
      productId: 1,
      sku: "ELC-0001",
      price: "49.49",
      costPrice: "21.40",
      stockQuantity: 0,
      isActive: true,
      rating: "4.1",
    });
    expect(products[0].description).toContain(
      "rich, balanced sound in a compact, pocket-friendly design",
    );
    expect(products[0].createdAt.toISOString()).toBe(
      "2025-03-08T03:42:04.000Z",
    );
    expect(products.filter((p) => !p.isActive).length).toBeGreaterThan(0);
    expect(products.find((p) => p.productId === 61)?.material).toBe(
      "Mesh, Nylon, and Steel",
    );
  });

  it("rejects the whole file with row-level reasons", () => {
    const [invalid] = errorsOf(
      `${header}\n${row({ price: "12.345", rating: "6.0", is_active: "maybe" })}`,
    );
    expect(invalid).toMatch(/^row 1 \(product_id 1\): /);
    for (const reason of [
      "price must be a non-negative decimal with up to 2 places",
      "rating must be between 0 and 5",
      "is_active must be true or false",
    ])
      expect(invalid).toContain(reason);
    expect(
      errorsOf(`${header}\n${row()}\n${row({ product_id: "2" })}`),
    ).toEqual(["row 2 (product_id 2): duplicate sku ELC-0001"]);
    expect(
      errorsOf(`${header}\n${row({ created_at: "2025-02-30 10:00:00" })}`)[0],
    ).toMatch(/created_at must be a timestamp/);
    expect(errorsOf(`product_id,sku\n1,A`)[0]).toMatch(
      /missing column\(s\): name, description/,
    );
    expect(errorsOf(`${header},secret\n${row()},x`)).toContain(
      "unknown column(s): secret",
    );
    expect(errorsOf(header)).toEqual(["the file has no product rows"]);
  });

  it("describes stock and status in words so natural questions retrieve them", () => {
    const [product] = parseProductCsv(
      `${header}\n${row({ is_active: "false" })}`,
    );
    const passage = productPassage(product);
    expect(passage.title).toBe("Test Earbuds (ELC-0001)");
    expect(passage.text).toContain("Stock: 0 units (out of stock)");
    expect(passage.text).toContain("Status: inactive (not on sale)");
    expect(passage.text).toContain("Price: 49.49 USD");
    expect(passage.text).toContain("Description: Rich sound, small case.");
  });
});
