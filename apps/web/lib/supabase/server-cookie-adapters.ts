type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

type ServerCookieStore = {
  getAll: () => Array<{ name: string; value: string }>;
  set: (name: string, value: string, options?: Record<string, unknown>) => unknown;
};

function reads(cookieStore: ServerCookieStore) {
  return {
    getAll() {
      return cookieStore.getAll();
    },
  };
}

export function strictRouteHandlerCookieMethods(cookieStore: ServerCookieStore) {
  return {
    ...reads(cookieStore),
    setAll(cookiesToSet: CookieToSet[]) {
      cookiesToSet.forEach(({ name, value, options }) => {
        cookieStore.set(name, value, options);
      });
    },
  };
}

export function tolerantServerComponentCookieMethods(cookieStore: ServerCookieStore) {
  return {
    ...reads(cookieStore),
    setAll(cookiesToSet: CookieToSet[]) {
      try {
        strictRouteHandlerCookieMethods(cookieStore).setAll(cookiesToSet);
      } catch {
        // Server Components cannot write response cookies. The narrow proxy
        // refreshes private raffle sessions before rendering those components.
      }
    },
  };
}
