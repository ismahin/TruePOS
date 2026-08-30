import { describe, expect, it } from "vitest";
import { bestSearchMatch, findMatchRanges, pickBestProductId, rankBySearchFields, rankSearchResults, scoreProductMatch } from "./search";

const products = [
  { id: "1", name: "Arduino Uno", sku: "ARD-UNO", barcode: "890001", category: "Boards" },
  { id: "2", name: "NRF52 Dev Kit", sku: "MIC-260687", barcode: "NRF-52", category: "MCU" },
  { id: "3", name: "Rice 5kg", sku: "RICE-5", barcode: "89900010001", category: "Grocery" },
  { id: "4", name: "ESP32", sku: "MIC-109690", barcode: "ESP32-WROOM", category: "MCU" }
];

describe("product search ranking", () => {
  it("prefers exact barcode and sku matches", () => {
    expect(bestSearchMatch(products, "NRF-52")?.id).toBe("2");
    expect(bestSearchMatch(products, "MIC-260687")?.id).toBe("2");
    expect(scoreProductMatch(products[1], "NRF-52")).toBeGreaterThan(scoreProductMatch(products[1], "kit"));
  });

  it("matches compacted queries like nrf52 against NRF-52", () => {
    const ranked = rankSearchResults(products, "nrf52");
    expect(ranked[0]?.id).toBe("2");
  });

  it("matches fuzzy gaps like es32 against ESP32", () => {
    expect(bestSearchMatch(products, "es32")?.id).toBe("4");
    expect(bestSearchMatch(products, "p32")?.id).toBe("4");
  });

  it("ranks name prefix above weak contains", () => {
    const ranked = rankSearchResults(products, "rice");
    expect(ranked[0]?.id).toBe("3");
  });

  it("picks the top ranked product while searching", () => {
    expect(pickBestProductId(rankSearchResults(products, "es32"), "es32", "1")).toBe("4");
    expect(pickBestProductId(products, "", "3")).toBe("3");
    expect(pickBestProductId([], "rice", "3")).toBe("");
  });
});

describe("field-mapped ranking", () => {
  it("ranks movement-like records with the product search algo", () => {
    const movements = [
      { id: "a", productName: "Arduino Uno", type: "stock_in", quantity: 2, note: "opening" },
      { id: "b", productName: "ESP32 Board", type: "adjustment", quantity: 1, note: "shelf count" },
      { id: "c", productName: "Rice 5kg", type: "sale", quantity: 5, note: "TP-1" }
    ];
    const ranked = rankBySearchFields(movements, "es32", (item) => ({
      name: item.productName,
      sku: item.type.replace(/_/g, " "),
      barcode: String(item.quantity),
      category: item.note
    }));
    expect(ranked[0]?.id).toBe("b");
  });
});

describe("match highlighting", () => {
  it("highlights contiguous query text", () => {
    expect(findMatchRanges("NRF52 Dev Kit", "nrf")).toEqual([{ start: 0, end: 3 }]);
    expect(findMatchRanges("Arduino Uno", "uno")).toEqual([{ start: 8, end: 11 }]);
  });

  it("highlights compact matches across separators", () => {
    expect(findMatchRanges("NRF-52 Dev", "nrf52")).toEqual([{ start: 0, end: 6 }]);
  });

  it("highlights fuzzy subsequence matches like es32 in ESP32", () => {
    expect(findMatchRanges("ESP32", "es32")).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 }
    ]);
  });

  it("highlights query phrases and separate tokens", () => {
    expect(findMatchRanges("NRF52 Dev Kit", "dev kit")).toEqual([{ start: 6, end: 13 }]);
    expect(findMatchRanges("NRF52 Blue Board Kit", "blue kit")).toEqual([
      { start: 6, end: 10 },
      { start: 17, end: 20 }
    ]);
  });
});
