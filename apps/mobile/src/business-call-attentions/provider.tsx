import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  EMPTY_BUSINESS_CALL_ATTENTION_SNAPSHOT,
  createBusinessCallAttentionSnapshot,
  type BusinessCallAttentionSnapshot,
} from "./presentation";
import type { BusinessCallAttentionRepository } from "./repository";

export type BusinessCallAttentionProviderState =
  | {
      readonly status: "loading";
      readonly snapshot: BusinessCallAttentionSnapshot;
    }
  | {
      readonly status: "ready";
      readonly snapshot: BusinessCallAttentionSnapshot;
    }
  | {
      readonly status: "failed";
      readonly snapshot: BusinessCallAttentionSnapshot;
      readonly error: Error;
    };

interface BusinessCallAttentionProviderProps {
  readonly children: ReactNode;
  readonly repository: BusinessCallAttentionRepository;
}

const BusinessCallAttentionContext =
  createContext<BusinessCallAttentionProviderState | null>(null);

export function BusinessCallAttentionProvider({
  children,
  repository,
}: BusinessCallAttentionProviderProps) {
  const [state, setState] = useState<BusinessCallAttentionProviderState>({
    status: "loading",
    snapshot: EMPTY_BUSINESS_CALL_ATTENTION_SNAPSHOT,
  });

  useEffect(() => {
    let disposed = false;
    let latestRequestId = 0;

    async function refresh() {
      const requestId = ++latestRequestId;
      try {
        const attentions = await repository.list();
        if (!disposed && requestId === latestRequestId) {
          setState({
            status: "ready",
            snapshot: createBusinessCallAttentionSnapshot(attentions),
          });
        }
      } catch (error) {
        if (!disposed && requestId === latestRequestId) {
          setState((current) => ({
            status: "failed",
            snapshot: current.snapshot,
            error: normalizeError(error),
          }));
        }
      }
    }

    setState({
      status: "loading",
      snapshot: EMPTY_BUSINESS_CALL_ATTENTION_SNAPSHOT,
    });
    const unsubscribe = repository.subscribe(() => {
      void refresh();
    });
    void refresh();

    return () => {
      disposed = true;
      latestRequestId += 1;
      unsubscribe();
    };
  }, [repository]);

  return (
    <BusinessCallAttentionContext.Provider value={state}>
      {children}
    </BusinessCallAttentionContext.Provider>
  );
}

export function useBusinessCallAttentionState(): BusinessCallAttentionProviderState {
  const state = useContext(BusinessCallAttentionContext);
  if (!state) {
    throw new Error(
      "useBusinessCallAttentionState must be used within BusinessCallAttentionProvider.",
    );
  }
  return state;
}

export function useBusinessCallAttentionSnapshot(): BusinessCallAttentionSnapshot {
  return useBusinessCallAttentionState().snapshot;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
