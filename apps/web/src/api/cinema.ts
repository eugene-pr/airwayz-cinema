import type { ReservationListResponse, ReservationResponse, SeatingMapResponse } from "@cinema/contracts";
import { request } from "./client";

export const getSeatingMap = () => request<SeatingMapResponse>("GET", "/api/seats");

export const listReservations = () => request<ReservationListResponse>("GET", "/api/reservations");

export const createReservation = (seatIds: string[]) =>
  request<ReservationResponse>("POST", "/api/reservations", { seatIds });

export const replaceReservationSeats = (id: string, seatIds: string[]) =>
  request<ReservationResponse>("PUT", `/api/reservations/${id}/seats`, { seatIds });

export const completeReservation = (id: string) =>
  request<ReservationResponse>("POST", `/api/reservations/${id}/complete`);

export const cancelReservation = (id: string) => request<void>("DELETE", `/api/reservations/${id}`);
