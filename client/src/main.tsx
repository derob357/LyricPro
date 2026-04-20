import { trpc } from "@/lib/trpc";
import { API_TRPC_URL } from "@/lib/apiBase";
import { getCurrentAccessToken } from "@/lib/supabase";
import { registerDeepLinkHandlers } from "@/lib/deepLink";
import { configureStatusBar } from "@/lib/nativeHooks";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: API_TRPC_URL || "/api/trpc",
      transformer: superjson,
      async headers() {
        // Attach the current Supabase access token on every tRPC request.
        // The server's supabase-auth module validates it and resolves to
        // the matching public.users row. Returns {} when unauthenticated.
        const token = await getCurrentAccessToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

// Conditionally inject Umami analytics only when configured.
const umamiEndpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT;
const umamiWebsiteId = import.meta.env.VITE_ANALYTICS_WEBSITE_ID;
if (umamiEndpoint && umamiWebsiteId) {
  const s = document.createElement("script");
  s.defer = true;
  s.src = `${umamiEndpoint}/umami`;
  s.setAttribute("data-website-id", umamiWebsiteId);
  document.body.appendChild(s);
}

// Capacitor URL-open listener for magic-link / OAuth callbacks that
// deep-link back into the native app. No-op on web.
registerDeepLinkHandlers();
// Configure the native status bar to match our dark purple theme.
configureStatusBar();

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
