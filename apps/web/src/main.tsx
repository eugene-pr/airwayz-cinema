import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ApiError } from "./api/client";
import { RequireUser } from "./components/require-user";
import { LoginPage } from "./routes/login";
import { SeatingPage } from "./routes/seating";
import "./styles.css";

// A 4xx won't change on retry; only transient failures are worth one.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2 },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* Keyed by user: a user switch in another tab remounts, so a pending write keeps its own user's cache. */}
          <Route
            path="/"
            element={<RequireUser>{(user) => <SeatingPage key={user.id} user={user} />}</RequireUser>}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
