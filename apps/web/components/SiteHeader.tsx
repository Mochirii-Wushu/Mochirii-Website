"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { OfficialGuildProfiles } from "@/components/OfficialGuildProfiles";
import { DISCORD_INVITE_URL } from "@/lib/public-urls";
import type { HomeRecruitment } from "@/lib/home-recruitment";
import { accountWorkflowLinks, navGroups, publicUtilityLinks, type NavGroup } from "@/lib/site-navigation";
import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type HeaderAuthState,
  navItemHidden,
  navKeyFromPath,
  SiteNavLink,
} from "./site-header/header-navigation";
import { SpinnerViewerNavLink } from "./site-header/spinner-viewer-nav-link";
import { useMobileMenuFocusTrap } from "./site-header/use-mobile-menu-focus-trap";

export function SiteHeader({
  authState,
  ensureAuthLoaded,
  ensureModeratorAccess,
  launchSpinnerViewer,
  homeRecruitment,
}: {
  authState: HeaderAuthState;
  ensureAuthLoaded: () => Promise<void>;
  ensureModeratorAccess: () => Promise<void>;
  launchSpinnerViewer: () => Promise<boolean>;
  homeRecruitment?: HomeRecruitment;
}) {
  const pathname = usePathname();
  const activeKey = navKeyFromPath(pathname);
  const navigationGroups = homeRecruitment ? navGroups.map((group) => ({
    ...group,
    items: group.items.map((item) => item.nav === "social-host" || item.nav === "forums-host"
      ? { ...item, label: `${item.label} (Coming Soon)` }
      : item.nav === "join" ? { ...item, label: "Joining Guide" } : item),
  })) : navGroups;
  const desktopGroups: NavGroup[] = homeRecruitment
    ? [{ id: "resources", label: "Resources", items: [] }]
    : navGroups;
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileShellRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { closeMobile, trapMobileTab } = useMobileMenuFocusTrap({
    mobileOpen,
    setMobileOpen,
    menuButtonRef,
    mobileShellRef,
    closeButtonRef,
  });

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    const closeDropdowns = (event: globalThis.MouseEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setOpenGroup(null);
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpenGroup(null);
    };

    document.addEventListener("click", closeDropdowns);
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("click", closeDropdowns);
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const toggleDropdown = (groupId: string) => {
    setOpenGroup((current) => (current === groupId ? null : groupId));
  };

  const focusFirstDropdownItem = (groupId: string) => {
    window.setTimeout(() => {
      const first = headerRef.current?.querySelector<HTMLAnchorElement>(
        `#nav-menu-${groupId} a`,
      );
      first?.focus({ preventScroll: true });
    }, 0);
  };

  return (
    <header
      id="site-header"
      ref={headerRef}
      className="site-header"
      data-variant={homeRecruitment ? "home" : undefined}
      data-state={scrolled ? "scrolled" : "top"}
      onPointerEnter={() => void ensureAuthLoaded()}
      onPointerDown={() => void ensureAuthLoaded()}
      onFocusCapture={() => void ensureAuthLoaded()}
    >
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <div className="header-wrap">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            <Image
              className="brand-emblem"
              src="/assets/img/brand/emblem.webp"
              alt=""
              width={56}
              height={56}
              sizes="56px"
              loading="eager"
              fetchPriority="low"
            />
          </span>
          <span className="brand-text">
            <span className="brand-name">Mōchirīī</span>
            <span className="brand-sub">Asia Pacific Guild</span>
          </span>
        </Link>

        <nav className="nav" aria-label="Primary">
          {homeRecruitment ? (
            <>
              <Link className="nav-link" href="/events" data-nav="events">Events</Link>
              <Link className="nav-link" href="/#guild-activity">Guild Activity</Link>
            </>
          ) : null}
          {desktopGroups.map((group) => {
            const isOpen = openGroup === group.id;

            return (
              <div
                className="nav-group"
                data-dropdown
                data-open={isOpen ? "true" : "false"}
                key={group.id}
              >
                <button
                  className="nav-link nav-trigger"
                  type="button"
                  data-dropdown-btn
                  aria-haspopup="true"
                  aria-expanded={isOpen}
                  aria-controls={`nav-menu-${group.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleDropdown(group.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleDropdown(group.id);
                    }

                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setOpenGroup(group.id);
                      focusFirstDropdownItem(group.id);
                    }
                  }}
                >
                  {group.label} <span className="nav-caret" aria-hidden="true">▾</span>
                </button>
                <div
                  className={`nav-menu${group.id === "resources" ? " home-resources-menu" : ""}`}
                  id={`nav-menu-${group.id}`}
                  hidden={!isOpen}
                  data-dropdown-menu
                >
                  {group.id === "resources" ? (
                    <>
                      <div className="home-resource-groups">
                        {navigationGroups.map((resourceGroup) => (
                          <div className="home-resource-group" key={resourceGroup.id}>
                            <div className="home-resource-title">{resourceGroup.label}</div>
                            {resourceGroup.items.filter((item) => !navItemHidden(item, authState)).map((item) => (
                              <SiteNavLink
                                className="nav-item"
                                item={item}
                                activeKey={activeKey}
                                key={item.nav}
                                onClick={() => setOpenGroup(null)}
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                      {publicUtilityLinks.filter((item) => !item.auth).map((item) => (
                        <SiteNavLink className="nav-item" item={item} key={item.nav} onClick={() => setOpenGroup(null)} />
                      ))}
                      <OfficialGuildProfiles
                        placement="header"
                        headerGroupLabel="Official Mōchirīī social profiles in the Resources menu"
                        onNavigate={() => setOpenGroup(null)}
                      />
                    </>
                  ) : group.items.filter((item) => !navItemHidden(item, authState)).map((item) => (
                    <SiteNavLink
                      className="nav-item"
                      item={item}
                      activeKey={activeKey}
                      key={item.nav}
                      onClick={() => setOpenGroup(null)}
                    />
                  ))}
                  {group.id === "guild" ? (
                    <OfficialGuildProfiles
                      placement="header"
                      onNavigate={() => setOpenGroup(null)}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}

          {!homeRecruitment ? publicUtilityLinks.filter((item) => !item.auth).map((item) => (
            <SiteNavLink
              className={`nav-link${item.auth ? " nav-auth-link" : ""}`}
              item={item}
              activeKey={activeKey}
              key={item.nav}
              hidden={navItemHidden(item, authState)}
            />
          )) : null}

          <div className="nav-auth-slot">
            {authState.signedIn ? (
              <div
                className="nav-group"
                data-dropdown
                data-open={openGroup === "account" ? "true" : "false"}
              >
                <button
                  className="nav-link nav-trigger"
                  type="button"
                  data-dropdown-btn
                  aria-haspopup="true"
                  aria-expanded={openGroup === "account"}
                  aria-controls="nav-menu-account"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleDropdown("account");
                    void ensureModeratorAccess();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleDropdown("account");
                      void ensureModeratorAccess();
                    }

                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setOpenGroup("account");
                      void ensureModeratorAccess();
                      focusFirstDropdownItem("account");
                    }
                  }}
                >
                  Account <span className="nav-caret" aria-hidden="true">{"\u25be"}</span>
                </button>
                <div
                  className="nav-menu"
                  id="nav-menu-account"
                  hidden={openGroup !== "account"}
                  data-dropdown-menu
                >
                  {accountWorkflowLinks.map((item) => (
                    item.auth === "spinner-viewer" ? (
                      <SpinnerViewerNavLink
                        className="nav-item"
                        item={item}
                        activeKey={activeKey}
                        key={item.nav}
                        onNavigate={() => setOpenGroup(null)}
                        hidden={navItemHidden(item, authState)}
                        launchSpinnerViewer={launchSpinnerViewer}
                      />
                    ) : (
                      <SiteNavLink
                        className="nav-item"
                        item={item}
                        activeKey={activeKey}
                        key={item.nav}
                        onClick={() => setOpenGroup(null)}
                        hidden={navItemHidden(item, authState)}
                      />
                    )
                  ))}
                </div>
              </div>
            ) : (
              publicUtilityLinks.filter((item) => item.auth === "signed-out").map((item) => (
                <SiteNavLink
                  className="nav-link nav-auth-link"
                  item={item}
                  activeKey={activeKey}
                  key={item.nav}
                />
              ))
            )}
          </div>
        </nav>

        <div className="utils">
          {homeRecruitment ? (
            homeRecruitment.open ? (
              <a className="cta" href={homeRecruitment.href} target="_blank" rel="noopener noreferrer">
                {homeRecruitment.label}<span className="cta-glint" aria-hidden="true" />
              </a>
            ) : (
              <Link className="cta" href={homeRecruitment.href}>{homeRecruitment.label}</Link>
            )
          ) : <a
            className="cta"
            href={DISCORD_INVITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Join Mōchirīī"
          >
            Join Mōchirīī <span className="cta-glint" aria-hidden="true" />
          </a>}

          <button
            className="burger"
            type="button"
            id="menu-btn"
            ref={menuButtonRef}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-menu"
            onClick={() => {
              if (mobileOpen) {
                closeMobile({ returnFocus: true });
              } else {
                void ensureModeratorAccess();
                setMobileOpen(true);
              }
            }}
          >
            <span className="burger-lines" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        className="mobile-shell"
        id="mobile-menu"
        ref={mobileShellRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        hidden={!mobileOpen}
        data-open={mobileOpen ? "true" : "false"}
        onKeyDown={trapMobileTab}
      >
        <div
          className="mobile-scrim"
          data-close
          aria-hidden="true"
          onClick={() => closeMobile({ returnFocus: true })}
        />
        <div className="mobile-sheet" role="document">
          <div className="mobile-top">
            <Link
              className="brand brand--mobile"
              href="/"
              onClick={() => closeMobile()}
            >
              <span className="brand-mark" aria-hidden="true">
                <Image
                  className="brand-emblem"
                  src="/assets/img/brand/emblem.webp"
                  alt=""
                  width={44}
                  height={44}
                  sizes="44px"
                />
              </span>
              <span className="brand-text">
                <span className="brand-name">Mōchirīī</span>
                <span className="brand-sub">Asia Pacific Guild</span>
              </span>
            </Link>

            <button
              className="icon-btn"
              type="button"
              data-close
              aria-label="Close menu"
              ref={closeButtonRef}
              onClick={() => closeMobile({ returnFocus: true })}
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>

          <nav className="mobile-nav" aria-label="Primary mobile">
            {homeRecruitment ? (
              <div className="mobile-group">
                <div className="mobile-group-title">Explore</div>
                <Link className="mobile-link" href="/events" onClick={() => closeMobile()}>Events</Link>
                <Link className="mobile-link" href="/#guild-activity" onClick={() => closeMobile()}>Guild Activity</Link>
              </div>
            ) : null}
            {navigationGroups.map((group) => (
              <div className="mobile-group" key={group.id}>
                <div className="mobile-group-title">{group.label}</div>
                {group.items.filter((item) => !navItemHidden(item, authState)).map((item) => (
                  <SiteNavLink
                    className="mobile-link"
                    item={item}
                    key={item.nav}
                    onClick={() => closeMobile()}
                  />
                ))}
              </div>
            ))}

            <div className="mobile-group">
              <div className="mobile-group-title">Official Social Profiles</div>
              <OfficialGuildProfiles
                placement="mobile"
                onNavigate={() => closeMobile()}
              />
            </div>

            <div className="mobile-group">
              <div className="mobile-group-title">Visit</div>
              {publicUtilityLinks.map((item) => (
                <SiteNavLink
                  className="mobile-link"
                  item={item}
                  activeKey={activeKey}
                  key={item.nav}
                  onClick={() => closeMobile()}
                  hidden={navItemHidden(item, authState)}
                />
              ))}
            </div>

            {authState.signedIn ? (
              <div className="mobile-group">
                <div className="mobile-group-title">Account</div>
                {accountWorkflowLinks.map((item) => (
                  item.auth === "spinner-viewer" ? (
                    <SpinnerViewerNavLink
                      className="mobile-link"
                      item={item}
                      activeKey={activeKey}
                      key={item.nav}
                      onNavigate={() => closeMobile()}
                      hidden={navItemHidden(item, authState)}
                      launchSpinnerViewer={launchSpinnerViewer}
                    />
                  ) : (
                    <SiteNavLink
                      className="mobile-link"
                      item={item}
                      activeKey={activeKey}
                      key={item.nav}
                      onClick={() => closeMobile()}
                      hidden={navItemHidden(item, authState)}
                    />
                  )
                ))}
              </div>
            ) : null}
          </nav>
        </div>
      </div>
    </header>
  );
}
