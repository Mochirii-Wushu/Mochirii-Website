import Image from "next/image";
import {
  FOOTER_GUILD_PROFILES,
  HEADER_GUILD_PROFILES,
  type OfficialGuildProfile,
} from "@/lib/public-urls";

type OfficialGuildProfilesProps = {
  placement: "header" | "mobile" | "footer";
  onNavigate?: () => void;
};

function profilesFor(placement: OfficialGuildProfilesProps["placement"]) {
  return placement === "footer" ? FOOTER_GUILD_PROFILES : HEADER_GUILD_PROFILES;
}

const placementLabels: Record<OfficialGuildProfilesProps["placement"], string> = {
  header: "Official Mōchirīī profiles in the Guild menu",
  mobile: "Official Mōchirīī profiles in the mobile menu",
  footer: "Official Mōchirīī profiles in the footer",
};

function OfficialGuildProfileLink({
  profile,
  onNavigate,
}: {
  profile: OfficialGuildProfile;
  onNavigate?: () => void;
}) {
  return (
    <a
      className="official-profile-link"
      href={profile.href}
      onClick={onNavigate}
      referrerPolicy="no-referrer"
      data-official-profile={profile.id}
      data-has-mark={profile.markAsset ? "true" : "false"}
    >
      {profile.markAsset ? (
        <span className="official-profile-mark" aria-hidden="true">
          <Image
            src={profile.markAsset}
            alt=""
            width={24}
            height={24}
            sizes="24px"
            unoptimized
          />
        </span>
      ) : null}
      <span className="official-profile-copy">
        {profile.markAsset ? (
          <span className="sr-only">{profile.label}</span>
        ) : (
          <span className="official-profile-platform">{profile.label}</span>
        )}
        <span className="official-profile-account">{profile.accountLabel}</span>
      </span>
      <span className="official-profile-external" aria-hidden="true">↗</span>
      <span className="sr-only"> external profile</span>
    </a>
  );
}

export function OfficialGuildProfiles({ placement, onNavigate }: OfficialGuildProfilesProps) {
  const profiles = profilesFor(placement);

  return (
    <div
      className={`official-profiles official-profiles--${placement}`}
      role="group"
      aria-label={placementLabels[placement]}
      data-official-profiles={placement}
    >
      {placement === "footer" ? (
        <h2 className="footer-col-title official-profiles-title">Official profiles</h2>
      ) : placement === "header" ? (
        <div className="official-profiles-title">Official profiles</div>
      ) : null}
      <ul className="official-profile-list">
        {profiles.map((profile) => (
          <li key={profile.id}>
            <OfficialGuildProfileLink profile={profile} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </div>
  );
}
