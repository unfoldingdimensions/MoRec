import { describe, expect, it } from "vitest";
import { areDeepEqual, clamp, isComparableObject } from "./utils";

describe("clamp", () => {
	it("clamps values below minimum", () => {
		expect(clamp(-5, 0, 10)).toBe(0);
	});

	it("clamps values above maximum", () => {
		expect(clamp(15, 0, 10)).toBe(10);
	});

	it("returns values within bounds unchanged", () => {
		expect(clamp(5, 0, 10)).toBe(5);
	});
});

describe("isComparableObject", () => {
	it("returns true for objects and arrays", () => {
		expect(isComparableObject({})).toBe(true);
		expect(isComparableObject({ a: 1 })).toBe(true);
		expect(isComparableObject([1, 2])).toBe(true);
	});

	it("returns false for primitives and null", () => {
		expect(isComparableObject(null)).toBe(false);
		expect(isComparableObject(undefined)).toBe(false);
		expect(isComparableObject(123)).toBe(false);
		expect(isComparableObject("string")).toBe(false);
		expect(isComparableObject(true)).toBe(false);
	});
});

describe("areDeepEqual", () => {
	it("returns true for identical primitives and references", () => {
		expect(areDeepEqual(42, 42)).toBe(true);
		expect(areDeepEqual("test", "test")).toBe(true);
		expect(areDeepEqual(null, null)).toBe(true);
		expect(areDeepEqual(undefined, undefined)).toBe(true);
	});

	it("returns true for deeply equal objects", () => {
		const objA = { x: 1, nested: { y: "hello", arr: [1, 2, 3] } };
		const objB = { x: 1, nested: { y: "hello", arr: [1, 2, 3] } };
		expect(areDeepEqual(objA, objB)).toBe(true);
	});

	it("returns false for objects with different keys or values", () => {
		expect(areDeepEqual({ a: 1 }, { a: 2 })).toBe(false);
		expect(areDeepEqual({ a: 1 }, { b: 1 })).toBe(false);
		expect(areDeepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
		expect(areDeepEqual([1, 2], [1, 2, 3])).toBe(false);
		expect(areDeepEqual([1, 2], [1, 3])).toBe(false);
	});
});
