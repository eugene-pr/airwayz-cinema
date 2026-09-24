import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/auth";

export function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      // Drop everything cached under the old token, including 401s from a poll after it expired.
      queryClient.clear();
      queryClient.setQueryData(["user"], user);
      navigate("/");
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate({ email, password });
  };

  return (
    <form className="login" onSubmit={onSubmit}>
      <h1>
        <span className="brand">AIRWAYZ</span> Cinema
      </h1>
      <label>
        Email
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      <button type="submit" disabled={mutation.isPending}>
        Log in
      </button>
      {mutation.error && <p className="notice">{mutation.error.message}</p>}
    </form>
  );
}
