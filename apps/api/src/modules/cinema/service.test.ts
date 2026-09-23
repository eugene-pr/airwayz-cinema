import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertUser, testPool } from "../../test-db";
import type { Actor } from "../auth";
import { type CinemaService, createCinemaService } from "./index";

let pool: pg.Pool;
let cinema: CinemaService;
let actor: Actor;

beforeAll(async () => {
  pool = await testPool();
  cinema = createCinemaService({ pool });
  actor = { userId: (await insertUser(pool, "password")).id };
});
afterAll(() => pool.end());

// ARCHITECTURE §7's two "Status derivation" cases (held then expired; completed stays
// booked) need reservations to exist. They land with the write path (tickets 05–06),
// not here via hand-written SQL fixtures.
describe("getSeatingMap", () => {
  it("returns all 115 seats in row order, with codes like A5 and K3", async () => {
    const { items } = await cinema.getSeatingMap(actor);

    expect(items).toHaveLength(115);
    expect(items.map((s) => s.code).slice(0, 3)).toEqual(["A1", "A2", "A3"]);
    expect(items.at(-1)?.code).toBe("M5");
    expect(items.find((s) => s.code === "A5")).toMatchObject({ rowLabel: "A", seatNumber: 5 });
    expect(items.find((s) => s.code === "K3")).toMatchObject({ rowLabel: "K", seatNumber: 3 });
  });

  it("has 10 seats in rows A–J and 5 in rows K–M", async () => {
    const { items } = await cinema.getSeatingMap(actor);
    const sizes = Object.fromEntries(
      [..."ABCDEFGHIJKLM"].map((row) => [row, items.filter((s) => s.rowLabel === row).length]),
    );

    expect(sizes).toEqual({
      ...Object.fromEntries([..."ABCDEFGHIJ"].map((row) => [row, 10])),
      K: 5,
      L: 5,
      M: 5,
    });
  });

  it("reads every seat as available when no reservation exists", async () => {
    const { items } = await cinema.getSeatingMap(actor);

    expect(new Set(items.map((s) => s.status))).toEqual(new Set(["available"]));
  });
});
