"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import type { NavItem } from "@/lib/site-navigation";

export type HeaderAuthState = {
  signedIn: boolean;
  activeMember: boolean;
  moderator: boolean;
  spinnerViewer: boolean;
};

export function navKeyFromPath(pathname: string | null) {
  const path = (pathname || "/").replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/index.html") return "home";
  if (path === "/raffle" || path.startsWith("/raffle/")) return "raffle";
  return path.slice(1).replace(/\.html$/, "") || "home";
}

export function navItemHidden(item: NavItem, authState: HeaderAuthState) {
  if (item.auth === "signed-out") return authState.signedIn;
  if (item.auth === "signed-in") return !authState.signedIn;
  if (item.auth === "verified") return !authState.activeMember;
  if (item.auth === "moderator") return !authState.moderator;
  if (item.auth === "spinner-viewer") return !authState.spinnerViewer;
  return false;
}

export function SiteNavLink({
  item,
  activeKey,
  className,
  onClick,
  hidden = false,
  prefetch,
}: {
  item: NavItem;
  activeKey?: string;
  className: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  hidden?: boolean;
  prefetch?: false;
}) {
  const isActive = !item.external && item.nav === activeKey;
  const authAttrs =
    item.auth === "signed-out"
      ? { "data-auth-signed-out": true }
      : item.auth === "signed-in"
        ? { "data-auth-signed-in": true }
        : item.auth === "verified"
          ? { "data-auth-verified": true }
          : item.auth === "moderator"
            ? { "data-auth-moderator": true }
            : item.auth === "spinner-viewer"
              ? { "data-auth-spinner-viewer": true }
            : {};

  if (item.external) {
    return (
      <a
        className={className}
        href={item.href}
        data-nav={item.nav}
        onClick={onClick}
        hidden={hidden}
        {...authAttrs}
      >
        {item.label}
      </a>
    );
  }

  return (
    <Link
      className={`${className}${isActive ? " is-active" : ""}`}
      href={item.href}
      data-nav={item.nav}
      prefetch={prefetch}
      aria-current={isActive ? "page" : undefined}
      onClick={onClick}
      hidden={hidden}
      {...authAttrs}
    >
      {item.label}
    </Link>
  );
}
