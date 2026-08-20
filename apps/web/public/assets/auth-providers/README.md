# Authentication Provider Marks

These files are official provider artwork used only to identify the matching
authentication option. They are not part of Mochirii's project license and may
not be reused, extracted, or redistributed as general-purpose brand assets.
Provider trademark and platform terms continue to apply.

The website does not recolor, distort, animate, or use these marks as Mochirii
branding. Apple and Google's generated PNGs are embedded byte-for-byte in local
SVG containers so the application can serve them without a third-party runtime
request. The other SVG paths are copied from the cited official provider files;
text serialization changes do not change their rendered geometry.

Retrieved and reviewed 2026-07-30:

Vendored SHA-256 values cover the canonical Git blob bytes with LF line
endings. The repository keeps this asset directory on LF for new checkouts;
validation also accepts an existing Windows CRLF checkout by converting only
CRLF pairs back to LF before hashing. Bare carriage returns, markup changes,
whitespace changes, missing trailing newlines, and every other byte change
remain hash failures.

| Provider | Official source | Source SHA-256 | Vendored file | Vendored SHA-256 |
| --- | --- | --- | --- | --- |
| Apple | `https://appleid.cdn-apple.com/appleid/button/logo?color=white&border=false&size=44&scale=2` | `542CBB6D7BF323587152B07F46AB8DA54A76362248B93F019C609DC2E61C333B` | `apple-logo.generated.svg` | `7D3C135C938C999A57D258CD4D12F55F34D3575FE79F95A83DA023A0BAEA62A2` |
| Facebook | `https://static.xx.fbcdn.net/rsrc.php/yE/r/xotM8R60Dei.svg` linked from Meta's Login Button documentation | `316535B6DE46AB29760DD143FDF2A893D7971B166A5FF11D12B19B6ACB53E932` | `facebook-login-mark.svg` | `316535B6DE46AB29760DD143FDF2A893D7971B166A5FF11D12B19B6ACB53E932` |
| Google | `https://developers.google.com/static/identity/images/signin-assets.zip`, Android + Web dark square icon at 2x | `2589CB7BAB12AF32A9BD8FF01ABFA4A71789F299D7F8DD52855B08F834160AFB` | `google-sign-in-dark-square.generated.svg` | `CF080920BE4C35B64D7F06CE67B333361045CD3DCC2F02E1233BFAFDDDB92E8A` |
| Discord | `https://cdn.discordapp.com/assets/content/80af2c38f13b4a7d2cb3572e1220f6e958d3c3aedccc7c7d3ddc9832f6b3d725.zip` | `DE4CC484CDC0E3A8F3A58A84B0C80C5AC8ACEFEEBF730930545FF3B279B5D0A3` | `discord-symbol-white.svg` | `2123B8A552A13349F8139EA81FA96FE10B84CC6C9B2A1545A62EC1F7B476AE76` |
| Twitch | `https://brand.twitch.com/uploads/Twitch-Brand.zip` | `CAC532FA9BBE3BA1DF462C5EFCDDA9BD03B3F0397C1B0D7464EE549E67ED25AC` | `twitch-glitch-white.svg` | `7FF2942CE7B169CB9175DF2BC2BE8292DA9C6701B5C5039C38EBE61A667ABBE6` |
| Spotify | `https://developer.spotify.com/images/guidelines/design/2024-spotify-logo-icon.zip` | `EAD72F82725038389CCA09F439FDB7807640E122500C934F2500C7036BF40DBB` | `spotify-primary-logo-green.svg` | `47A07A15F0DF73699A72621F9E42B4F4A50B035373664A8F6A384310AEF1DE2C` |

Facebook and Spotify remain source-staged but production-disabled until their
OAuth configuration, end-to-end callback tests, and provider-specific brand
approval gates are complete. Source presence does not authorize activation.
