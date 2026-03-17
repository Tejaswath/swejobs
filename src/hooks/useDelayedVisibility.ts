import { useEffect, useState } from "react";

export function useDelayedVisibility(active: boolean, delay = 150) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }

    const timeout = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timeout);
  }, [active, delay]);

  return visible;
}
