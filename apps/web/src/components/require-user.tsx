import type { UserResponse } from "@cinema/contracts";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { getUser } from "../api/auth";
import { ApiError } from "../api/client";

// The cookie is httpOnly, so GET /api/auth/me is how the app knows it is logged in (ARCHITECTURE §10).
export function RequireUser({ children }: { children: (user: UserResponse) => ReactNode }) {
  const { data, error, isPending } = useQuery({ queryKey: ["user"], queryFn: getUser });
  if (isPending) return <p>Loading…</p>;
  if (error instanceof ApiError && error.status === 401) return <Navigate to="/login" replace />;
  if (error) return <p className="notice">{error.message}</p>;
  return children(data);
}
