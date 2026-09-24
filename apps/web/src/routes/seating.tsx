import type { ReservationListResponse, ReservationResponse, UserResponse } from "@cinema/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { logout } from "../api/auth";
import {
  cancelReservation,
  completeReservation,
  createReservation,
  getSeatingMap,
  listReservations,
  replaceReservationSeats,
} from "../api/cinema";
import { ApiError } from "../api/client";
import { Countdown } from "../components/countdown";
import { SeatingMap } from "../components/seating-map";
import { checkDraft, describeDraftViolation } from "../lib/selection";

// Freshness is a 5s poll, not push (ARCHITECTURE §2 #10), kept up in background tabs too.
// No optimistic updates: a write's own response goes into the reservations cache, then both re-fetch.
const POLL = { refetchInterval: 5000, refetchIntervalInBackground: true };

export function SeatingPage({ user }: { user: UserResponse }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const seatsQuery = useQuery({ queryKey: ["seats"], queryFn: getSeatingMap, ...POLL });
  // Keyed by user: a write still pending at logout resolves into its own user's entry, never the next user's.
  const reservationsKey = ["reservations", user.id];
  const reservationsQuery = useQuery({ queryKey: reservationsKey, queryFn: listReservations, ...POLL });
  // null = no edits: the selection follows the held reservation's seats.
  const [draft, setDraft] = useState<string[] | null>(null);

  const refetch = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["seats"] }),
      queryClient.invalidateQueries({ queryKey: reservationsKey }),
    ]);
  // Each write resolves to how it changed the actor's reservations, per the server's response.
  // Applying that before dropping the draft means a failed re-fetch can't revert the held seats
  // to stale ones (and enable Complete for seats the server no longer holds).
  const write = useMutation({
    mutationFn: (run: () => Promise<(items: ReservationResponse[]) => ReservationResponse[]>) => run(),
    onSuccess: async (update) => {
      // A poll in flight since before the write would land stale data over ours.
      await queryClient.cancelQueries({ queryKey: reservationsKey });
      queryClient.setQueryData<ReservationListResponse>(
        reservationsKey,
        (old) => old && { items: update(old.items) },
      );
      setDraft(null);
      await refetch();
    },
    onError: refetch,
  });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      navigate("/login");
    },
  });

  const error = seatsQuery.error ?? reservationsQuery.error;
  if (error instanceof ApiError && error.status === 401) return <Navigate to="/login" replace />;
  // A failed poll keeps the last good data (React Query v5); only a failed first load blanks the page.
  if (!seatsQuery.data || !reservationsQuery.data)
    return error ? <p className="notice">{error.message}</p> : <p>Loading…</p>;

  const seats = seatsQuery.data.items;
  const reservations = reservationsQuery.data.items;
  // Which seats are mine: a client-side join against the actor's own reservations (ARCHITECTURE §10).
  const held = reservations.find((reservation) => reservation.status === "held");
  const heldSeatIds = new Set(held?.seatIds);
  const ownSeatIds = new Set(reservations.flatMap((reservation) => reservation.seatIds));
  const bookedCodes = seats
    .filter((seat) => ownSeatIds.has(seat.id) && !heldSeatIds.has(seat.id))
    .map((seat) => seat.code);

  const selection = draft ?? held?.seatIds ?? [];
  const edited = draft !== null && !sameSeats(draft, held?.seatIds ?? []);
  const violation = checkDraft(seats, heldSeatIds, selection);
  const canSubmit = selection.length > 0 && !violation && !write.isPending;
  const codes = (ids: readonly string[]) =>
    seats.filter((seat) => ids.includes(seat.id)).map((seat) => seat.code);

  const toggle = (seatId: string) => {
    if (write.isPending) return; // reset() would drop tracking of the in-flight write
    write.reset();
    setDraft(selection.includes(seatId) ? selection.filter((id) => id !== seatId) : [...selection, seatId]);
  };

  return (
    <main className="seating">
      <header>
        <h1>
          <span className="brand">AIRWAYZ</span> Cinema
        </h1>
        <span className="muted">{user.email}</span>
        <button
          type="button"
          className="ghost"
          disabled={logoutMutation.isPending}
          onClick={() => logoutMutation.mutate()}
        >
          Log out
        </button>
      </header>
      {logoutMutation.error && <p className="notice">{logoutMutation.error.message}</p>}
      {error && <p className="notice">Connection lost — retrying. Seats shown may be out of date.</p>}

      <div className="layout">
        <div>
          <SeatingMap
            seats={seats}
            selection={selection}
            ownSeatIds={ownSeatIds}
            onToggle={toggle}
            locked={write.isPending}
          />

          <ul className="legend">
            <li className="seat available">Available</li>
            <li className="seat reserved">Reserved</li>
            <li className="seat booked">Booked</li>
            <li className="seat selected">Your selection</li>
            <li className="seat booked own">Your booked seat</li>
          </ul>
        </div>

        <aside className="panel">
          <p className="muted">Selection: {selection.length > 0 ? codes(selection).join(", ") : "none"}</p>
          {violation && <p className="notice">{describeDraftViolation(violation)}</p>}

          {held ? (
            <>
              <p>
                Reservation held: {codes(held.seatIds).join(", ")} — expires in{" "}
                <Countdown until={held.expiresAt} onExpire={refetch} />
              </p>
              <button
                type="button"
                disabled={!edited || !canSubmit}
                onClick={() => write.mutate(() => replaceReservationSeats(held.id, selection).then(saved))}
              >
                Change seats
              </button>
              <button
                type="button"
                disabled={edited || write.isPending}
                onClick={() => write.mutate(() => completeReservation(held.id).then(saved))}
              >
                Complete reservation
              </button>
              <button
                type="button"
                className="ghost"
                disabled={write.isPending}
                onClick={() => write.mutate(() => cancelReservation(held.id).then(() => dropped(held.id)))}
              >
                Cancel reservation
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => write.mutate(() => createReservation(selection).then(saved))}
            >
              Reserve seats
            </button>
          )}

          {write.error && <p className="notice">{write.error.message}</p>}
          {bookedCodes.length > 0 && <p>Your booked seats: {bookedCodes.join(", ")}</p>}
        </aside>
      </div>
    </main>
  );
}

// Cancelled reservations are never on the wire (§11), so a cancel removes it from the list.
const saved = (reservation: ReservationResponse) => (items: ReservationResponse[]) =>
  items.some((item) => item.id === reservation.id)
    ? items.map((item) => (item.id === reservation.id ? reservation : item))
    : [...items, reservation];
const dropped = (id: string) => (items: ReservationResponse[]) => items.filter((item) => item.id !== id);

function sameSeats(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}
