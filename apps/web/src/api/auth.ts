import type { LoginRequest, UserResponse } from "@cinema/contracts";
import { request } from "./client";

export const login = (credentials: LoginRequest) =>
  request<UserResponse>("POST", "/api/auth/login", credentials);

export const logout = () => request<void>("POST", "/api/auth/logout");

export const getUser = () => request<UserResponse>("GET", "/api/auth/me");
