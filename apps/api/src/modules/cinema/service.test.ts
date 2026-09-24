import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../middleware/app-error";
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

// Any UPDATE to a hold row changes its xmin, so an unchanged xmin proves nothing was written.
async function xminOf(reservationId: string) {
  const { rows } = await pool.query<{ xmin: string }>("SELECT xmin::text FROM holds WHERE id = $1", [
    reservationId,
  ]);
  return rows[0]?.xmin;
}

// A service whose clock_timestamp() — and so checked_at — is frozen at `at`. The shim schema
// precedes pg_catalog on search_path, so it shadows the built-in. Test-only.
async function serviceFrozenAt(at: string) {
  await pool.query("CREATE SCHEMA IF NOT EXISTS test_clock");
  await pool.query(
    `CREATE OR REPLACE FUNCTION test_clock.clock_timestamp() RETURNS timestamptz
     LANGUAGE sql AS $$ SELECT '${at}'::timestamptz $$`,
  );
  const frozenPool = await testPool({ options: "-c search_path=test_clock,pg_catalog,public" });
  return { frozen: createCinemaService({ pool: frozenPool }), end: () => frozenPool.end() };
}

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

  it("status derivation, held then expired: reserved, then available the moment the deadline passes — no write", async () => {
    const alice = await newActor();
    const held = await cinema.createReservation(alice, ids("A1"));
    expect(await statuses("A1")).toEqual(["reserved"]);

    await expire(held.id);

    expect(await statuses("A1")).toEqual(["available"]);
    expect(await holdStatusesOf(alice)).toEqual(["held"]);
  });

  it("status derivation, completed is permanent: booked, and still booked after the original deadline", async () => {
    const alice = await newActor();
    const held = await cinema.createReservation(alice, ids("A1"));
    await cinema.completeReservation(alice, held.id);
    expect(await statuses("A1")).toEqual(["booked"]);

    await expire(held.id);

    expect(await statuses("A1")).toEqual(["booked"]);
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
    // The loser would isolate A3: it names the rule, not a requested seat (§3.3).
    expect(rejected[0]).toMatchObject({ code: "SEATS_UNAVAILABLE", details: { rule: 2 } });
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
      details: { rule: 2 },
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

  // §2 #33: a saturated pool isn't a moved seat, so it stays a plain error — a 500.
  it("bounded pool wait: every connection checked out, fails fast as a server error, not a conflict", async () => {
    const tinyPool = await testPool({ max: 1, connectionTimeoutMillis: 200 });
    const tiny = createCinemaService({ pool: tinyPool });
    const hog = await tinyPool.connect();
    try {
      const failure = await tiny.createReservation(await newActor(), ids("A1")).catch((err: unknown) => err);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(AppError);
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

  it("rejects a non-consecutive replacement (Rule 1), keeping the previous seats", async () => {
    const alice = await newActor();
    const held = await cinema.createReservation(alice, ids("A1", "A2"));

    await expect(cinema.replaceReservationSeats(alice, held.id, ids("A4", "A6"))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      details: { rule: 1 },
    });
    expect(await claimedCodesOf(held.id)).toEqual(["A1", "A2"]);
  });

  // A2 only becomes an isolated seat once the replacement releases Alice's own A2–A3.
  it("rejects a replacement that isolates a seat its own release frees (Rule 2)", async () => {
    const [alice, bob] = [await newActor(), await newActor()];
    await cinema.createReservation(bob, ids("A1"));
    const held = await cinema.createReservation(alice, ids("A2", "A3"));

    await expect(cinema.replaceReservationSeats(alice, held.id, ids("A3", "A4"))).rejects.toMatchObject({
      code: "SEATS_UNAVAILABLE",
      details: { rule: 2 },
    });
    expect(await claimedCodesOf(held.id)).toEqual(["A2", "A3"]);
  });

  // A2 was isolated before the change, so extending past it creates no new isolated seat (§5.2).
  it("accepts a replacement bordering an isolated seat that already exists", async () => {
    const [alice, bob, carol] = [await newActor(), await newActor(), await newActor()];
    await cinema.completeReservation(carol, (await cinema.createReservation(carol, ids("A1"))).id);
    const bobs = await cinema.createReservation(bob, ids("A2"));
    const held = await cinema.createReservation(alice, ids("A3"));
    await cinema.cancelReservation(bob, bobs.id);

    await cinema.replaceReservationSeats(alice, held.id, ids("A3", "A4"));
    expect(await claimedCodesOf(held.id)).toEqual(["A3", "A4"]);
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

  it("a completed reservation fails RESERVATION_NOT_HELD, keeping its seats", async () => {
    const alice = await newActor();
    const held = await cinema.createReservation(alice, ids("A1", "A2"));
    await cinema.completeReservation(alice, held.id);

    await expect(cinema.replaceReservationSeats(alice, held.id, ids("A3", "A4"))).rejects.toMatchObject({
      code: "RESERVATION_NOT_HELD",
    });
    expect(await claimedCodesOf(held.id)).toEqual(["A1", "A2"]);
  });
});

describe("completeReservation", () => {
  it("completes an owned held reservation; its seats read booked", async () => {
    const alice = await newActor();
    const held = await cinema.createReservation(alice, ids("A1", "A2"));

    const completed = await cinema.completeReservation(alice, held.id);

    expect(completed).toEqual({ ...held, status: "completed" });
    expect(await statuses("A1", "A2")).toEqual(["booked", "booked"]);
  });

  it("after expiry, before reclamation, fails RESERVATION_NOT_HELD; the seats stay available", async () => {
    const alice = await newActor();
    const held = await cinema.createReservation(alice, ids("A1", "A2"));
    await expire(held.id);

    await expect(cinema.completeReservation(alice, held.id)).rejects.toMatchObject({
      code: "RESERVATION_NOT_HELD",
    });
    expect(await statuses("A1", "A2")).toEqual(["available", "available"]);
  });

  it("after another user reclaims the seats, fails; the new user's hold and claims stay intact", async () => {
    const [alice, bob] = [await newActor(), await newActor()];
    const alices = await cinema.createReservation(alice, ids("A1", "A2"));
    await expire(alices.id);
    const bobs = await cinema.createReservation(bob, ids("A1", "A2"));

    await expect(cinema.completeReservation(alice, alices.id)).rejects.toMatchObject({
      code: "RESERVATION_NOT_HELD",
    });
    expect(await holdStatusesOf(bob)).toEqual(["held"]);
    expect(await claimedCodesOf(bobs.id)).toEqual(["A1", "A2"]);
  });

  it("expiry during a lock wait: begins before the deadline, locks acquired after it — fails", async () => {
    const alice = await newActor();
    const held = await cinema.createReservation(alice, ids("A1"));
    await pool.query("UPDATE holds SET expires_at = clock_timestamp() + interval '300 ms' WHERE id = $1", [
      held.id,
    ]);
    const release = await lockRow(1);

    const completing = cinema.completeReservation(alice, held.id);
    await waitForLockWaiters(1);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await release();

    await expect(completing).rejects.toMatchObject({ code: "RESERVATION_NOT_HELD" });
  });

  it("expiry exactly at checked_at fails (expires_at <= checked_at)", async () => {
    const alice = await newActor();
    const held = await cinema.createReservation(alice, ids("A1"));
    const { rows } = await pool.query<{ at: string }>(
      "SELECT expires_at::text AS at FROM holds WHERE id = $1",
      [held.id],
    );
    const { frozen, end } = await serviceFrozenAt(rows[0]?.at ?? "");
    try {
      await expect(frozen.completeReservation(alice, held.id)).rejects.toMatchObject({
        code: "RESERVATION_NOT_HELD",
      });
    } finally {
      await end();
    }
  });

  it("another user's reservation is notFound, not forbidden", async () => {
    const [alice, bob] = [await newActor(), await newActor()];
    const held = await cinema.createReservation(alice, ids("A1", "A2"));

    await expect(cinema.completeReservation(bob, held.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await holdStatusesOf(alice)).toEqual(["held"]);
  });

  it("is idempotent: completing an already-completed own reservation returns it and writes nothing", async () => {
    const alice = await newActor();
    const held = await cinema.createReservation(alice, ids("A1", "A2"));
    const first = await cinema.completeReservation(alice, held.id);
    const xmin = await xminOf(held.id);

    const retried = await cinema.completeReservation(alice, held.id);

    expect(retried).toEqual(first);
    expect(await xminOf(held.id)).toBe(xmin);
    expect(await claimedCodesOf(held.id)).toEqual(["A1", "A2"]);
  });

  it("a cancelled reservation fails RESERVATION_NOT_HELD", async () => {
    const alice = await newActor();
    const held = await cinema.createReservation(alice, ids("A1", "A2"));
    await cinema.cancelReservation(alice, held.id);

    await expect(cinema.completeReservation(alice, held.id)).rejects.toMatchObject({
      code: "RESERVATION_NOT_HELD",
    });
  });

  it("another user's completed reservation is still notFound", async () => {
    const [alice, bob] = [await newActor(), await newActor()];
    const held = await cinema.createReservation(alice, ids("A1", "A2"));
    await cinema.completeReservation(alice, held.id);

    await expect(cinema.completeReservation(bob, held.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("cancelReservation", () => {
  it("cancels an owned unexpired hold, releasing its seats", async () => {
    const alice = await newActor();
    const held = await cinema.createReservation(alice, ids("A1", "A2"));

    await cinema.cancelReservation(alice, held.id);

    expect(await holdStatusesOf(alice)).toEqual(["cancelled"]);
    expect(await claimedCodesOf(held.id)).toEqual([]);
    expect(await statuses("A1", "A2")).toEqual(["available", "available"]);
  });

  it("another user's reservation is notFound; nothing is released", async () => {
    const [alice, bob] = [await newActor(), await newActor()];
    const held = await cinema.createReservation(alice, ids("A1", "A2"));

    await expect(cinema.cancelReservation(bob, held.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await claimedCodesOf(held.id)).toEqual(["A1", "A2"]);
  });

  it("a completed reservation fails RESERVATION_NOT_HELD, keeping its seats", async () => {
    const alice = await newActor();
    const held = await cinema.createReservation(alice, ids("A1", "A2"));
    await cinema.completeReservation(alice, held.id);

    await expect(cinema.cancelReservation(alice, held.id)).rejects.toMatchObject({
      code: "RESERVATION_NOT_HELD",
    });
    expect(await claimedCodesOf(held.id)).toEqual(["A1", "A2"]);
    expect(await statuses("A1", "A2")).toEqual(["booked", "booked"]);
  });

  it("an expired hold, before reclamation, fails RESERVATION_NOT_HELD", async () => {
    const alice = await newActor();
    const held = await cinema.createReservation(alice, ids("A1", "A2"));
    await expire(held.id);

    await expect(cinema.cancelReservation(alice, held.id)).rejects.toMatchObject({
      code: "RESERVATION_NOT_HELD",
    });
    expect(await holdStatusesOf(alice)).toEqual(["held"]);
  });

  it("targeting an expired hold another user has since reclaimed fails, leaving their claims intact", async () => {
    const [alice, bob] = [await newActor(), await newActor()];
    const alices = await cinema.createReservation(alice, ids("A1", "A2"));
    await expire(alices.id);
    const bobs = await cinema.createReservation(bob, ids("A1", "A2"));

    await expect(cinema.cancelReservation(alice, alices.id)).rejects.toMatchObject({
      code: "RESERVATION_NOT_HELD",
    });
    expect(await claimedCodesOf(bobs.id)).toEqual(["A1", "A2"]);
  });

  it("an already cancelled hold fails RESERVATION_NOT_HELD, leaving a later holder's claims intact", async () => {
    const [alice, bob] = [await newActor(), await newActor()];
    const alices = await cinema.createReservation(alice, ids("A1", "A2"));
    await cinema.cancelReservation(alice, alices.id);
    const bobs = await cinema.createReservation(bob, ids("A1", "A2"));

    await expect(cinema.cancelReservation(alice, alices.id)).rejects.toMatchObject({
      code: "RESERVATION_NOT_HELD",
    });
    expect(await claimedCodesOf(bobs.id)).toEqual(["A1", "A2"]);
  });
});

describe("listReservations", () => {
  it("own reservations only: the actor's unexpired hold and completed ones, with seat ids", async () => {
    const [alice, bob] = [await newActor(), await newActor()];
    const expired = await cinema.createReservation(alice, ids("A1"));
    await expire(expired.id);
    const cancelled = await cinema.createReservation(alice, ids("B1"));
    await cinema.cancelReservation(alice, cancelled.id);
    const completed = await cinema.completeReservation(
      alice,
      (await cinema.createReservation(alice, ids("C1", "C2"))).id,
    );
    const held = await cinema.createReservation(alice, ids("D1"));
    const bobs = await cinema.createReservation(bob, ids("E1"));
    await cinema.completeReservation(bob, bobs.id);
    await cinema.createReservation(bob, ids("F1"));

    const { items } = await cinema.listReservations(alice);

    expect(items).toEqual([completed, held]);
  });
});
