import { describe, expect, it } from "vitest";
import { type Seat, validateRule1, validateSelection } from "./index";

// # = occupied, * = selected, . = empty. Seat IDs use "row-seat".
function parseRow(pattern: string, rowNumber = 1): { seats: Seat[]; seatIds: string[] } {
  const seats = [...pattern].map((cell, i) => ({
    id: `${rowNumber}-${i + 1}`,
    rowNumber,
    seatNumber: i + 1,
    occupied: cell === "#",
  }));
  const seatIds = seats.filter((_, i) => pattern[i] === "*").map((seat) => seat.id);
  return { seats, seatIds };
}

function validate(pattern: string) {
  const { seats, seatIds } = parseRow(pattern);
  return validateSelection(seats, seatIds);
}

describe("Rule 1 — seats must be consecutive and in the same row", () => {
  it.each([
    ["....***...", "row A: 5, 6, 7", null],
    ["....*.*...", "row A: 5, 7 — not consecutive", { rule: 1 }],
    ["**........", "row B: 1, 2", null],
    [".**.*.....", "row C: 2, 3, 5 — reported as Rule 1, not Rule 2", { rule: 1 }],
    ["....*.....", "a single seat", null],
    ["*.*..", "5-seat row: 1, 3", { rule: 1 }],
  ])("%s  %s", (pattern, _title, expected) => {
    expect(validate(pattern)).toEqual(expected);
  });

  it("rejects seats in different rows, even with adjacent seat numbers", () => {
    const a = parseRow("..........", 1);
    const b = parseRow("..........", 2);
    expect(validateSelection([...a.seats, ...b.seats], ["1-5", "2-6"])).toEqual({ rule: 1 });
  });

  it("rejects the same seat selected twice", () => {
    const { seats } = parseRow("..........");
    expect(validateSelection(seats, ["1-5", "1-5"])).toEqual({ rule: 1 });
  });

  it("accepts consecutive seats given out of order", () => {
    const { seats } = parseRow("..........");
    expect(validateSelection(seats, ["1-7", "1-5", "1-6"])).toBeNull();
  });

  it("checks Rule 1 even when a selected seat is occupied", () => {
    const { seats } = parseRow("..#.......");
    expect(validateRule1(seats, ["1-1", "1-3"])).toEqual({ rule: 1 });
    expect(validateSelection(seats, ["1-1", "1-3"])).toEqual({ rule: 1 });
    expect(validateRule1(seats, ["1-2", "1-3"])).toBeNull();
  });
});

describe("Rule 2 — no isolated seat, 10-seat rows", () => {
  it.each([
    ["##**......", "TASK example: fills up to the booked seats", null],
    ["##.**.....", "TASK example: seat 3 isolated", { rule: 2, isolatedSeatNumbers: [3] }],
    [".*********", "TASK example: seat 1 empty at the row edge", null],
    ["*********.", "seat 10 empty at the row edge", null],
    ["...**.#...", "isolated seat on the right of the selection", { rule: 2, isolatedSeatNumbers: [6] }],
    ["#..**.....", "gap of two", null],
    ["#.*.......", "single seat isolates its neighbour (§5.1)", { rule: 2, isolatedSeatNumbers: [2] }],
    [".#.*.#....", "single seat isolates both neighbours", { rule: 2, isolatedSeatNumbers: [3, 5] }],
    ["#*.#......", "§5.4: seat 2 alone isolates seat 3", { rule: 2, isolatedSeatNumbers: [3] }],
    ["#.*#......", "§5.4: seat 3 alone isolates seat 2", { rule: 2, isolatedSeatNumbers: [2] }],
    ["#**#......", "§5.4: seats 2 and 3 together", null],
    ["****.#....", "seat 5 is mid-row in a 10-seat row", { rule: 2, isolatedSeatNumbers: [5] }],
  ])("%s  %s", (pattern, _title, expected) => {
    expect(validate(pattern)).toEqual(expected);
  });
});

describe("Rule 2 — validates the delta, pre-existing isolated seats are tolerated (§5.2)", () => {
  it.each([
    ["#.#...**..", "isolated seat 2 already exists elsewhere in the row", null],
    ["#*#.......", "selection fills the existing gap", null],
    ["#.#.*.....", "reports only the new isolated seat", { rule: 2, isolatedSeatNumbers: [4] }],
    ["#.#**", "5-seat row: isolated seat 2 already exists", null],
  ])("%s  %s", (pattern, _title, expected) => {
    expect(validate(pattern)).toEqual(expected);
  });
});

describe("preconditions — caller bugs, not rule violations", () => {
  const { seats } = parseRow("#.........");

  it("throws on an empty selection", () => {
    expect(() => validateSelection(seats, [])).toThrow();
  });

  it("throws on an unknown seat id", () => {
    expect(() => validateSelection(seats, ["9-9"])).toThrow();
  });

  it("throws when a selected seat is occupied", () => {
    expect(() => validateSelection(seats, ["1-1", "1-2"])).toThrow();
  });
});

describe("Rule 2 — no isolated seat, 5-seat rows", () => {
  it.each([
    ["****.", "seat 5 empty at the row edge", null],
    [".****", "seat 1 empty at the row edge", null],
    ["*****", "whole row", null],
    ["#.**.", "seat 2 isolated", { rule: 2, isolatedSeatNumbers: [2] }],
    [".*.#.", "seat 3 isolated", { rule: 2, isolatedSeatNumbers: [3] }],
  ])("%s  %s", (pattern, _title, expected) => {
    expect(validate(pattern)).toEqual(expected);
  });
});
