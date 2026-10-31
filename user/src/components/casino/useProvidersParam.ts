import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const parse = (search: string) => (new URLSearchParams(search).get("providers") || "").split(",").filter(Boolean);

/**
 * A lobby's provider filter, kept in ?providers=Name,Name. The URL seeds it and is followed when it changes (back and
 * forward, the home's provider tiles); a change made in the lobby is written back. Each direction compares before it
 * writes, and the write-back runs only when the selection itself changes, so the two can no longer ping-pong (they
 * did: about nine history replacements a second on any ?providers= link, and the page never settled).
 */
export function useProvidersParam() {
  const location = useLocation();
  const navigate = useNavigate();
  const [providers, setProviders] = useState<string[]>(() => parse(location.search));
  const latest = useRef(location);
  latest.current = location;

  useEffect(() => {
    const next = parse(location.search);
    setProviders(current => (current.join(",") === next.join(",") ? current : next));
  }, [location.search]);

  useEffect(() => {
    const { pathname, search } = latest.current;
    const params = new URLSearchParams(search);
    if (providers.length > 0) params.set("providers", providers.join(","));
    else params.delete("providers");
    const nextSearch = params.toString() ? `?${params.toString()}` : "";
    if (parse(nextSearch).join(",") !== parse(search).join(",")) navigate({ pathname, search: nextSearch }, { replace: true });
  }, [providers, navigate]);

  return [providers, setProviders] as const;
}
