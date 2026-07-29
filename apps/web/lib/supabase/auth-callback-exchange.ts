type AuthCodeExchanger = {
  exchangeCodeForSession: (code: string) => Promise<{ error?: unknown }>;
};

export async function exchangeAuthCodeForCookieSession(auth: AuthCodeExchanger, code: string) {
  try {
    const result = await auth.exchangeCodeForSession(code);
    return !result.error;
  } catch {
    // A cookie-write failure is an authentication failure, never success.
    return false;
  }
}
