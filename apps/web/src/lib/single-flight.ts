import { useCallback, useEffect, useRef } from "react";

/**
 * Impede envios duplicados: bloqueia de forma síncrona (antes de o React voltar a
 * renderizar com `pending = true`) e só liberta quando o pedido termina.
 */
export function useSingleFlight(pending: boolean): (action: () => void) => void {
  const locked = useRef(false);
  useEffect(() => {
    if (!pending) locked.current = false;
  }, [pending]);
  return useCallback(
    (action: () => void) => {
      if (pending || locked.current) return;
      locked.current = true;
      action();
    },
    [pending],
  );
}
