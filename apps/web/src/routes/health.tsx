import { useQuery } from "@tanstack/react-query";
import { getHealth } from "../api/health";

export function HealthPage() {
  const { data, error, isPending } = useQuery({ queryKey: ["health"], queryFn: getHealth });
  if (isPending) return <p>Loading…</p>;
  if (error) return <p>API unreachable: {error.message}</p>;
  return (
    <p>
      API ok — database time <time dateTime={data.serverTime}>{data.serverTime}</time>
    </p>
  );
}
