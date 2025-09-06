"use client";

import {
  QueryClient,
  QueryClientProvider as QueryClientProviderTanstack,
} from "@tanstack/react-query";

type TProps = { children: React.ReactNode };

const queryClient = new QueryClient();

export default function QueryClientProvider({ children }: TProps) {
  return (
    <QueryClientProviderTanstack client={queryClient}>
      {children}
    </QueryClientProviderTanstack>
  );
}
