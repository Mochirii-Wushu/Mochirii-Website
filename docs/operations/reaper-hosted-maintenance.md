# Reaper hosted maintenance

Observed 2026-10-11, UTC+8. This runbook separates hosted serving and scheduled
work from dormant capabilities and unresolved auxiliary maintenance. It does
not authorize activation, publication, migration, provider changes, or retries.

## Current public surfaces

The Website runs on Vercel, the storefront on Shopify, and the backend on
Supabase. Anonymous checks at 01:12 UTC+8 on 11 October returned HTTP 200 with
Vercel headers and the respective Coming Soon titles at both
`https://social.mochirii.com` and `https://forums.mochirii.com`.

These two public origins serve reviewed immutable static shell artifacts. The
Social application remains owned by `Mochirii-Wushu/Mochirii-Social`; the Forums
application remains a separate repository and release unit. A static shell
does not establish application availability, authenticated behavior, process
health, backups, or recovery readiness. It does not relocate either application
into Website source. Earlier Social runtime descriptions are historical until
a current application readback establishes otherwise.

## Hosted schedules and inactive capabilities

The 01:14 UTC+8 read-only Supabase inventory on 11 October reported four active
cron jobs: monthly spotlight, the event-advancement tick, daily spinner
maintenance, and the five-second spinner dispatcher. Their latest recorded
executions were successful: spotlight at 16:05 UTC, advancement at 17:14 UTC,
daily spinner maintenance at 03:17 UTC, and spinner dispatch at 17:14:40 UTC
on 10 October. This establishes recorded execution, not delivery of every
external side effect. The older 24 July spotlight record remains unchanged
as historical evidence.

The separate 01:02:18 UTC+8 readback on 11 October showed the event-advancement
policy was false. That observation is historical: after the approved eleven-
activity registry reconciliation, guarded activation succeeded at
10:12:10 UTC+8. The next natural minute tick succeeded without dispatching work,
because no event was due. This verifies activation and an idle execution;
the first natural Breaking Army advancement is due at or after 00:02 UTC+8 on
13 October, with Showdown following on 14 October. Neither natural advancement
has yet been observed. No forced event was used to test production. See the
[event-sync runbook](../reaper-event-sync-runbook.md). Native recurring Discord
series are maintained by Discord; they do not require a workstation scheduler.
The vote reminder was absent from the observed active cron inventory and is
not activated.

Website remains the current production writer for its Supabase Reaper Edge
Functions. The persistent Gateway worker is a separate runtime; its source
candidate is not evidence of a production Edge ownership cutover.

## Gateway continuity gap

The owner requests active hosted welcome DMs and member-event forwarding. That
intent does not establish deployment or activation; the current evidence gap
below must be closed through the separately reviewed Gateway release.

The public `Mochirii-Wushu/Reaper-Discord-Bot` main revision read at 01:12 UTC+8
was `ff17ec1b0aa008a4787591982d02697b259db274`. Its
[runtime runbook](https://github.com/Mochirii-Wushu/Reaper-Discord-Bot/blob/ff17ec1b0aa008a4787591982d02697b259db274/docs/runtime-operations.md)
declares `SOURCE_ONLY_NOT_DEPLOYED`. Its
[artifact contract](https://github.com/Mochirii-Wushu/Reaper-Discord-Bot/blob/ff17ec1b0aa008a4787591982d02697b259db274/docs/operations/gateway-artifact.v1.json)
does not select a host or registry and leaves publication/deployment gates
false. CI builds without publishing; GitHub returned no deployment records.
These facts do not prove that an independently deployed older worker or local
workstation process is absent.

The subsequent protected PR #12 publication on 11 October superseded that
source/image observation. Main commit
`73a635d35373cc5b8678a28239297425fbe693b2` passed CI and its single approved
image publisher completed at 11:18:43 UTC+8. The canonical image's immutable
digest, signature, provenance and SBOM were independently verified; the image
had no high/critical vulnerabilities or scanner-detected secrets. This proves
publication only. Package pull access, paid host provisioning, runtime secrets,
welcome/member forwarding and hosted acceptance are still pending. The new
local recovery/monitoring candidate is separately reviewed source, not part of
that published image. See [Gateway operations](reaper-gateway-operations.md).

The source defines a nonroot OCI image and a private readiness probe. Before
certifying a live Gateway, obtain a redacted readback of its actual provider
class, supervisor, boot policy, deployed revision and immutable digest, and
fresh healthy readiness. Observe restart, reconnect or session resume,
rollback, and a full host reboot while the workstation is offline. Do not
record host addresses, private identifiers, secret values, or process output
in this runbook. No live Gateway health was established by this audit.

## Auxiliary maintenance gaps

The read-only audit found an ACTIVE local heartbeat named
`Keep Mōchirīī Facebook Events Current` on 11 October. Desktop-local heartbeat
execution requires the workstation; it is an auxiliary maintenance exception
to the hosted serving contract. The previously recorded Facebook recurring
event editor capacity barrier remains unresolved. No migration of that
automation, native Event retry, series split/recreation, API substitution, or
capacity workaround is authorized by this runbook. Reconcile the current
provider state and obtain an exact decision before changing that workflow.

The Social backup/recovery readback also remains pending. Confirm the owning
runtime's backup timer, newest encrypted recovery point, and one isolated
validate-only restore through its protected recovery workflow. Public Coming
Soon responses provide no such evidence.

Keep `complete_auxiliary_continuity_certified` false while these gaps remain.
`npm run check:host-independence` checks the source contract;
`npm run gate:host-independence` intentionally fails while the Gateway and
Social recovery records remain pending. Passing a source check does not certify
all auxiliary maintenance or prove operation with the workstation offline.
