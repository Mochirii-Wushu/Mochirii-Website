# Legal and privacy current-main source inventory

Status: `SOURCE_ONLY_INCOMPLETE`

This packet records repository facts only. It is not legal advice, public legal
copy, provider or production proof, counsel approval, activation authority, or
deployment authority. It makes no source or provider changes outside the files
that define and validate this packet.

## Exact source boundary

- Repository: `Mochirii-Wushu/Mochirii-Website`
- Protected-main commit: `d5e55abfb5e5d6fbecaf7da1cec762ba9bc9cdab`
- Protected-main tree: `7112abe8872b255e5c8231728ebda893b0064fed`
- Commit timestamp: `2026-08-11T21:12:04-07:00`
- Source inspection timestamp: `2026-08-13T06:22:03-07:00`
- Machine-readable inventory: `docs/operations/legal-privacy-current-main.v2.json`

The inherited July source packet is bound by commit, tree, path, and blob in
the machine-readable inventory. Its 36 source references were compared with
the protected-main anchor through Git object data, producing exactly:

- 17 byte-identical references;
- 9 changed references; and
- 10 references absent from the protected-main tree.

Every inherited reference has an exact inherited blob and either an exact
current blob or an explicit `ABSENT_AT_ANCHOR` disposition. Every new current
reference is likewise bound to an exact blob in the protected-main tree. A
same, changed, or absent label is therefore a source identity result, not a
runtime or legal conclusion.

## Consequential current-source facts

- Website has no App Router source for `/privacy`, `/contact`, or
  `/data-deletion` at the anchor. Its footer has no privacy, terms, contact, or
  deletion link.
- Social's shared privacy source still directs people to the absent Website
  contact route.
- Website source includes Vercel Analytics and Speed Insights. Source presence
  does not prove current hosted collection, settings, contracts, regions, or
  retention.
- Gallery source accepts member media and metadata through Website and Discord
  paths, including Discord guild, channel, message, attachment, and user
  identifiers. It records an optional Instagram-publication choice and exposes
  approved media through one-hour signed URLs with uploader display fields. The
  public-attribution decision, notice, withdrawal path, full retention schedule,
  and runtime behavior remain unresolved.
- The rejected-gallery cleanup function deletes the Storage object before the
  database row and reports partial failure if row deletion fails. No runtime
  execution is asserted.
- Social desktop and mobile terms can use one database page but retain
  different source fallbacks. The legal-notice route has no repository content
  fallback, the data-policy source is unfinished, and the platform-terms source
  is empty.
- Social deletion help makes broad removal claims while source configuration
  defaults deletion on with no queued delay. Environment and cached runtime
  configuration can override both settings; backup, moderation, security,
  legal-hold, restore, and cross-system outcomes remain unproved.
- Spinner migrations state a 30-day source rule for draw receipts and media
  jobs. Hosted schedules, execution, cleanup, and recovery are not proven.
- Current raffle data says there is no active raffle, entries are closed, no
  current rules version is active, and no public reward is defined.
- Storefront source remains approval-gated; repository readiness records do not
  establish current Shopify policy, privacy-choice, payment, tax, fulfillment,
  or production state.
- Mobile and playable game provider facts remain deferred. Their source
  presence does not activate either surface.

The inventory separately records routes, integrations, data flows, public
claims, retention and deletion, rights, providers, and approval gates. Facts
that cannot be established from the exact source remain `null` and carry an
owner, a concrete question, and required evidence. No contract, provider
readback, jurisdiction, legal basis, retention period, rights deadline, or
counsel conclusion is inferred.

## Fail-closed state

The packet preserves all of these invariants:

- `completeness` is `false`;
- `activationEffect` is `none`;
- activation and public-copy authorization are `false`;
- provider readback is `false`;
- counsel review is `false`; and
- `READY`, `APPROVED`, and `COMPLETE` are not valid row states.

Changing a status, adding a provider fact, publishing copy, activating a route,
or mutating a provider requires evidence and authority outside this packet.

## Remaining gates

The accountable owners still need to resolve and evidence:

1. operator identity, jurisdiction, audience, language, contact, and age facts;
2. processing purposes, legal bases, retention, deletion, rights, consent, and
   incident workflows;
3. contracts, subprocessors, regions, transfers, deletion or return terms, and
   security evidence for every provider;
4. exact public privacy, terms, legal-notice, community, contact, deletion, and
   assent copy and routes;
5. Gallery attribution, depicted-person consent, delivery, withdrawal,
   retention, and deletion behavior;
6. separate raffle and storefront launch requirements;
7. future mobile and game architecture, privacy, age, safety, artifact, and
   launch decisions; and
8. a private, qualified-review packet with budget approval, exact-copy review,
   and an explicit release decision.

Provider readback and production verification must be captured separately as
sanitized immutable evidence. Private evidence locations, account identifiers,
credentials, contracts, member data, and private legal work product do not
belong in this source packet.

## Validation

From the repository root with the pinned Node runtime:

```text
fnm exec --using=22.23.1 -- node scripts/check-legal-privacy-current-main.mjs
fnm exec --using=22.23.1 -- node --test scripts/check-legal-privacy-current-main.test.mjs
fnm exec --using=22.23.1 -- npm run check:legal-privacy-current-main
git diff --check
```

The checker binds exact schemas, row IDs, repository-relative paths, Git blobs,
delta classifications, source observations, unresolved-null discipline,
privacy boundaries, and the fail-closed authorization state. Hostile tests must
reject missing or changed references and fabricated readiness or approval.
