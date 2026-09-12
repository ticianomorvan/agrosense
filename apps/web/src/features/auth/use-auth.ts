import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { type AuthClient, getAuthClient } from "./client";

export type AuthState =
  | { status: "loading"; client: null; session: null; message: null }
  | { status: "unavailable"; client: null; session: null; message: string }
  | {
      status: "ready";
      client: AuthClient;
      session: Session | null;
      message: null;
    };

const initialState: AuthState = {
  status: "loading",
  client: null,
  session: null,
  message: null,
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>(initialState);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    getAuthClient()
      .then((client) => {
        if (!active) return;
        // INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED and SIGNED_OUT all flow
        // through this subscription: https://supabase.com/docs/reference/javascript/auth-onauthstatechange
        const { data } = client.auth.onAuthStateChange((_event, session) => {
          if (active)
            setState({
              status: "ready",
              client,
              session,
              message: null,
            });
        });
        unsubscribe = () => data.subscription.unsubscribe();
      })
      .catch(() => {
        if (active)
          setState({
            status: "unavailable",
            client: null,
            session: null,
            message: "Sign-in configuration could not be loaded.",
          });
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  return state;
}
