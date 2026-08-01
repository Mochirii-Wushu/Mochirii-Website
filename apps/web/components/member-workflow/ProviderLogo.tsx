import Image from "next/image";
import type { AuthProviderId } from "@/lib/supabase/auth-providers";

type ProviderLogoProps = {
  provider: AuthProviderId;
};

const OFFICIAL_PROVIDER_ASSETS: Partial<Record<AuthProviderId, {
  src: string;
  width: number;
  height: number;
}>> = {
  apple: {
    src: "/assets/auth-providers/apple-logo.generated.svg",
    width: 56,
    height: 56,
  },
  facebook: {
    src: "/assets/auth-providers/facebook-login-mark.svg",
    width: 22,
    height: 22,
  },
  google: {
    src: "/assets/auth-providers/google-g.generated.svg",
    width: 20,
    height: 20,
  },
  discord: {
    src: "/assets/auth-providers/discord-symbol-white.svg",
    width: 29,
    height: 22,
  },
  twitch: {
    src: "/assets/auth-providers/twitch-glitch-white.svg",
    width: 24,
    height: 28,
  },
  spotify: {
    src: "/assets/auth-providers/spotify-primary-logo-green.svg",
    width: 24,
    height: 23,
  },
};

export function ProviderLogo({ provider }: ProviderLogoProps) {
  const officialAsset = OFFICIAL_PROVIDER_ASSETS[provider];

  return (
    <span className={`provider-logo provider-logo--${provider}`} aria-hidden="true">
      {officialAsset ? (
        <Image
          alt=""
          aria-hidden="true"
          draggable={false}
          height={officialAsset.height}
          src={officialAsset.src}
          unoptimized
          width={officialAsset.width}
        />
      ) : (
        <svg viewBox="0 0 24 24" focusable="false">
          {provider === "kakao" ? (
            <path fill="currentColor" d="M12 4C6.48 4 2 7.53 2 11.9c0 2.83 1.88 5.31 4.7 6.7l-.97 3.06a.34.34 0 0 0 .53.37l3.78-2.5c.64.1 1.3.16 1.96.16 5.52 0 10-3.53 10-7.89S17.52 4 12 4Z" />
          ) : null}
          {provider === "phone" ? (
            <path fill="currentColor" d="M16.7 2.8H7.3A2.3 2.3 0 0 0 5 5.1v13.8a2.3 2.3 0 0 0 2.3 2.3h9.4a2.3 2.3 0 0 0 2.3-2.3V5.1a2.3 2.3 0 0 0-2.3-2.3ZM8 5h8v11H8V5Zm4 14.65a1.05 1.05 0 1 1 0-2.1 1.05 1.05 0 0 1 0 2.1Z" />
          ) : null}
        </svg>
      )}
    </span>
  );
}
