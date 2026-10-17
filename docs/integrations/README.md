# Mochirii integrations

Reference material for the connections between the website, member services,
storefront, and community features.

## Start here

- [Architecture](../architecture.md)
- [Repository ownership](../operations/repository-ownership.md)
- [Hosted service contracts](hosted-runtime.json)
- [Member entitlement foundation](member-entitlement-state-foundation.v1.md)
- [Forums sign-in](mochirii-forums-discourse-connect.md)
- [Mochi Pets website contract](mochi-pets-website-contract.md)

The Website repository owns the website, storefront theme, shared backend,
and its identity connections. Mochirii Social application releases and recovery
belong to [Mochirii Social](https://github.com/Mochirii-Wushu/Mochirii-Social).

These documents describe interfaces and responsibilities. Follow the
[release guides](../operations/README.md) for approved changes.

Keep credential values, cookies, signed URLs, private keys, member data, and
supplier records out of these files. Configuration names and sanitized examples
are sufficient.
