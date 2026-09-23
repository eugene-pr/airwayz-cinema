import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insertUser, testPool } from "../../test-db";
import type { Actor } from "../auth";
import { type CinemaService, createCinemaService } from "./index";
import { ROW_LOCK_NAMESPACE, USER_LOCK_NAMESPACE } from "./repository";

let pool: pg.Pool;
let cinema: CinemaService;
let actor: Actor;
const seatIdByCode = new Map<string, string>();

beforeAll(async () => {
  pool = await testPool();
  cinema = createCinemaService({ pool });
  actor = await newActor();
  for (const seat of (await cinema.getSeatingMap(actor)).items) seatIdByCode.set(seat.code, seat.id);
});
afterAll(() => pool.end());

// This file is the only one that writes holds, so it may reset them (ARCHITECTURE §2 #35).
beforeEach(async () => {
  await pool.query("DELETE FROM seat_claims");
  await pool.query("DELETE FROM holds");
});

const newActor = async (): Promise<Actor> => ({ userId: (await insertUser(pool, "password")).id });

function ids(...codes: string[]) {
  return codes.map((code) => {
    const id = seatIdByCode.get(code);
    if (!id) throw new Error(`no seat ${code}`);
    return id;
  });
}

async function statuses(...codes: string[]) {
  const { items } = await cinema.getSeatingMap(actor);
  return codes.map((code) => items.find((seat) => seat.code === code)?.status);
}

// Test-only time travel: the app never updates expires_at (§6).
async function expire(reservationId: string) {
  await pool.query("UPDATE holds SET expires_at = clock_timestamp() - interval '1 second' WHERE id = $1", [
    reservationId,
  ]);
}

async function holdStatusesOf({ userId }: Actor) {
  const { rows } = await pool.query<{ status: string }>(
    "SELECT status FROM holds WHERE user_id = $1 ORDER BY created_at",
    [userId],
  );
  return rows.map((row) => row.status);
}

async function claimedCodesOf(reservationId: string) {
  const { rows } = await pool.query<{ code: string }>(
    `SELECT s.row_label || s.seat_number AS code FROM seat_claims c JOIN seats s ON s.id = c.seat_id
     WHERE c.hold_id = $1 ORDER BY s.row_number, s.seat_number`,
    [reservationId],
  );
  return rows.map((row) => row.code);
}

// Takes a seat row's lock (§3.1) from outside the service, so parallel calls queue behind it.
async function lockRow(rowNumber: number) {
  const client = await pool.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock($1, $2)", [ROW_LOCK_NAMESPACE, rowNumber]);
  return async () => {
    await client.query("COMMIT");
    client.release();
  };
}

// Resolves once `count` transactions are blocked on a user or seat-row lock. A service that
// skips the lock never gets here, so the test times out instead of passing by luck.
async function waitForLockWaiters(count: number) {
  for (;;) {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_locks
       WHERE locktype = 'advisory' AND classid IN ($1, $2) AND objsubid = 2 AND NOT granted`,
      [USER_LOCK_NAMESPACE, ROW_LOCK_NAMESPACE],
    );
    if ((rows[0]?.n ?? 0) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function fulfilledAndRejected<T>(results: PromiseSettledResult<T>[]) {
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected").map((r) => r.reason);
  return { fulfilled, rejected };
}

// ARCHITECTURE §7's two "Status derivation" cases (held then expired; completed stays
// booked) need completion; they land with ticket 06.
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

describe("createReservation", () => {
  it("creates a held reservation expiring 15 minutes after checked_at; its seats read reserved", async () => {
    const alice = await newActor();
    const before = Date.now();

    const reservation = await cinema.createReservation(alice, ids("A1", "A2"));

    expect(reservation).toMatchObject({ status: "held", seatIds: ids("A1", "A2") });
    const deadline = new Date(reservation.expiresAt).getTime();
    expect(deadline).toBeGreaterThan(before + 15 * 60_000 - 5_000);
    expect(deadline).toBeLessThan(Date.now() + 15 * 60_000 + 5_000);
    expect(await statuses("A1", "A2", "A3")).toEqual(["reserved", "reserved", "available"]);
  });

  it("overlapping race: two users request the same seat concurrently — exactly one wins", async () => {
    const [alice, bob] = [await newActor(), await newActor()];
    const release = await lockRow(1);

    const racing = Promise.allSettled([
      cinema.createReservation(alice, ids("A5")),
      cinema.createReservation(bob, ids("A5")),
    ]);
    await waitForLockWaiters(2);
    await release();
    const { fulfilled, rejected } = fulfilledAndRejected(await racing);

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ code: "SEATS_UNAVAILABLE", details: { seatIds: ids("A5") } });
  });

  it("row-level race: non-overlapping selections that jointly leave an isolated seat — exactly one wins", async () => {
    const [alice, bob] = [await newActor(), await newActor()];
    const release = await lockRow(1);

    const racing = Promise.allSettled([
      cinema.createReservation(alice, ids("A1", "A2")),
      cinema.createReservation(bob, ids("A4", "A5")),
    ]);
    await waitForLockWaiters(2);
    await release();
    const { fulfilled, rejected } = fulfilledAndRejected(await racing);

    expect(fulfilled).toHaveLength(1);
    // A gap cause names no requested seat (§3.3).
    expect(rejected[0]).toMatchObject({ code: "SEATS_UNAVAILABLE", details: undefined });
    expect(await statuses("A3")).toEqual(["available"]);
    expect((await statuses("A1", "A2", "A4", "A5")).filter((s) => s === "reserved")).toHaveLength(2);
  });

  it("partial unavailability rolls back: a 3-seat selection with one occupied seat commits nothing", async () => {
    const [alice, bob] = [await newActor(), await newActor()];
    await cinema.createReservation(bob, ids("A3"));

    await expect(cinema.createReservation(alice, ids("A2", "A3", "A4"))).rejects.toMatchObject({
      code: "SEATS_UNAVAILABLE",
      details: { seatIds: ids("A3") },
    });
    expect(await holdStatusesOf(alice)).toEqual([]);
    expect(await statuses("A2", "A4")).toEqual(["available", "available"]);
  });

  it("an expired hold reads as available, with no reclamation run", async () => {
    const alice = await newActor();
    const reservation = await cinema.createReservation(alice, ids("A1", "A2"));
    await expire(reservation.id);

    expect(await statuses("A1", "A2")).toEqual(["available", "available"]);
    expect(await holdStatusesOf(alice)).toEqual(["held"]);
  });

  it("expired hold in another row: the user creates a fresh hold in row B after their row A hold expires", async () => {
    const alice = await newActor();
    const old = await cinema.createReservation(alice, ids("A1", "A2"));
    await expire(old.id);

    const fresh = await cinema.createReservation(alice, ids("B1", "B2"));

    expect(new Date(fresh.expiresAt).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(await holdStatusesOf(alice)).toEqual(["cancelled", "held"]);
    expect(await claimedCodesOf(old.id)).toEqual([]);
  });

  it("reclaims another user's expired hold in the requested row", async () => {
    const [alice, bob] = [await newActor(), await newActor()];
    const bobs = await cinema.createReservation(bob, ids("A1", "A2"));
    await expire(bobs.id);

    await cinema.createReservation(alice, ids("A1", "A2"));

    expect(await holdStatusesOf(bob)).toEqual(["cancelled"]);
    expect(await claimedCodesOf(bobs.id)).toEqual([]);
  });

  it("create while holding a different selection fails RESERVATION_ALREADY_HELD", async () => {
    const alice = await newActor();
    await cinema.createReservation(alice, ids("A1", "A2"));

    await expect(cinema.createReservation(alice, ids("B1", "B2"))).rejects.toMatchObject({
      code: "RESERVATION_ALREADY_HELD",
    });
    expect(await statuses("B1", "B2")).toEqual(["available", "available"]);
  });

  it("create while holding the same selection returns the held reservation and writes nothing", async () => {
    const alice = await newActor();
    const first = await cinema.createReservation(alice, ids("A1", "A2"));

    const retried = await cinema.createReservation(alice, ids("A2", "A1"));

    expect(retried).toEqual(first);
    expect(await holdStatusesOf(alice)).toEqual(["held"]);
  });

  it("rejects a non-consecutive selection (Rule 1)", async () => {
    const alice = await newActor();

    await expect(cinema.createReservation(alice, ids("A1", "A3"))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      details: { rule: 1 },
    });
  });

  it("reports Rule 1 before an occupied seat in the same selection", async () => {
    const [alice, bob] = [await newActor(), await newActor()];
    await cinema.createReservation(bob, ids("A3"));

    await expect(cinema.createReservation(alice, ids("A1", "A3"))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      details: { rule: 1 },
    });
  });

  it("rejects a single-seat selection that leaves an isolated seat (Rule 2)", async () => {
    const [alice, bob] = [await newActor(), await newActor()];
    await cinema.createReservation(bob, ids("A1"));

    await expect(cinema.createReservation(alice, ids("A3"))).rejects.toMatchObject({
      code: "SEATS_UNAVAILABLE",
      details: undefined,
    });
  });

  it("rejects an unknown seat id", async () => {
    const alice = await newActor();

    await expect(
      cinema.createReservation(alice, ["00000000-0000-4000-8000-000000000000"]),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("bounded lock wait: blocked on a seat row lock, fails SEATS_UNAVAILABLE instead of hanging", async () => {
    const impatientPool = await testPool({ options: "-c lock_timeout=200ms" });
    const impatient = createCinemaService({ pool: impatientPool });
    const release = await lockRow(1);
    try {
      await expect(impatient.createReservation(await newActor(), ids("A1"))).rejects.toMatchObject({
        code: "SEATS_UNAVAILABLE",
        details: undefined,
      });
    } finally {
      await release();
      await impatientPool.end();
    }
  });

  it("bounded pool wait: every connection checked out, fails SEATS_UNAVAILABLE instead of hanging", async () => {
    const tinyPool = await testPool({ max: 1, connectionTimeoutMillis: 200 });
    const tiny = createCinemaService({ pool: tinyPool });
    const hog = await tinyPool.connect();
    try {
      await expect(tiny.createReservation(await newActor(), ids("A1"))).rejects.toMatchObject({
        code: "SEATS_UNAVAILABLE",
        details: undefined,
      });
    } finally {
      hog.release();
      await tinyPool.end();
    }
  });
});

describe("replaceReservationSeats", () => {
  it("moves the selection within a row, keeping the deadline", async () => {
    const alice = await newActor();
    const held = await cinema.createReservation(alice, ids("A1", "A2"));

    const moved = await cinema.replaceReservationSeats(alice, held.id, ids("A3", "A4"));

    expect(moved).toEqual({ ...held, seatIds: ids("A3", "A4") });
    expect(await statuses("A1", "A2", "A3", "A4")).toEqual([
      "available",
      "available",
      "reserved",
      "reserved",
    ]);
  });

  it("moves the selection between rows, keeping the deadline and creating no second hold", async () => {
    const alice = await newActor();
    const held = await cinema.createReservation(alice, ids("A1", "A2"));

    const moved = await cinema.replaceReservationSeats(alice, held.id, ids("B5", "B6"));

    expect(moved).toEqual({ ...held, seatIds: ids("B5", "B6") });
    expect(await holdStatusesOf(alice)).toEqual(["held"]);
    expect(await statuses("A1", "A2")).toEqual(["available", "available"]);
  });

  it("failure preserves the previous seats and deadline", async () => {
    const [alice, bob] = [await newActor(), await newActor()];
    const held = await cinema.createReservation(alice, ids("A1", "A2"));
    await cinema.createReservation(bob, ids("B1"));

    await expect(cinema.replaceReservationSeats(alice, held.id, ids("B1", "B2"))).rejects.toMatchObject({
      code: "SEATS_UNAVAILABLE",
      details: { seatIds: ids("B1") },
    });
    expect(await claimedCodesOf(held.id)).toEqual(["A1", "A2"]);
    expect(await holdStatusesOf(alice)).toEqual(["held"]);
    const { rows } = await pool.query<{ expires_at: Date }>("SELECT expires_at FROM holds WHERE id = $1", [
      held.id,
    ]);
    expect(rows[0]?.expires_at.toISOString()).toBe(held.expiresAt);
  });

  it("concurrent replacements by the same user leave one intact selection with no leftover claims", async () => {
    const alice = await newActor();
    const held = await cinema.createReservation(alice, ids("A1", "A2"));
    const release = await lockRow(1);

    const racing = Promise.allSettled([
      cinema.replaceReservationSeats(alice, held.id, ids("A5", "A6")),
      cinema.replaceReservationSeats(alice, held.id, ids("B1", "B2")),
    ]);
    // One waits on the row lock, the other behind it on the user lock.
    await waitForLockWaiters(2);
    await release();
    const { fulfilled } = fulfilledAndRejected(await racing);

    expect(fulfilled).toHaveLength(2);
    expect([
      ["A5", "A6"],
      ["B1", "B2"],
    ]).toContainEqual(await claimedCodesOf(held.id));
    expect(await holdStatusesOf(alice)).toEqual(["held"]);
  });

  it("users swapping rows follow the same lock order — both succeed, no deadlock", async () => {
    const [alice, bob] = [await newActor(), await newActor()];
    const alices = await cinema.createReservation(alice, ids("A1", "A2"));
    const bobs = await cinema.createReservation(bob, ids("B1", "B2"));
    const release = await lockRow(1);

    // Alice queues on row A first. A service that locked her old row before her new one
    // would then hold A while Bob holds B, and each would wait on the other.
    const aliceMoves = cinema.replaceReservationSeats(alice, alices.id, ids("B5", "B6"));
    await waitForLockWaiters(1);
    const bobMoves = cinema.replaceReservationSeats(bob, bobs.id, ids("A5", "A6"));
    await waitForLockWaiters(2);
    await release();
    const { fulfilled } = fulfilledAndRejected(await Promise.allSettled([aliceMoves, bobMoves]));

    expect(fulfilled).toHaveLength(2);
    expect(await claimedCodesOf(alices.id)).toEqual(["B5", "B6"]);
    expect(await claimedCodesOf(bobs.id)).toEqual(["A5", "A6"]);
  });

  it("another user's reservation is notFound, not forbidden", async () => {
    const [alice, bob] = [await newActor(), await newActor()];
    const held = await cinema.createReservation(alice, ids("A1", "A2"));

    await expect(cinema.replaceReservationSeats(bob, held.id, ids("B1", "B2"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await claimedCodesOf(held.id)).toEqual(["A1", "A2"]);
  });

  // The failed write rolls back its reclamation too; reads already treat the hold as expired (§4).
  it("an expired reservation fails RESERVATION_NOT_HELD", async () => {
    const alice = await newActor();
    const held = await cinema.createReservation(alice, ids("A1", "A2"));
    await expire(held.id);

    await expect(cinema.replaceReservationSeats(alice, held.id, ids("A3", "A4"))).rejects.toMatchObject({
      code: "RESERVATION_NOT_HELD",
    });
    expect(await statuses("A1", "A2", "A3", "A4")).toEqual([
      "available",
      "available",
      "available",
      "available",
    ]);
  });
});
