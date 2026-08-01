# Social Open-Source Release Readiness

This document defines a technical readiness contract; it does not provide a legal conclusion.
Qualified counsel approval of the notice, source scope, and release process
remains a production-release gate.

## Public Notice

`/site/open-source` is an anonymous, no-member-data surface. Its link remains in
the shared footer on login, restricted, authenticated, and error shells even
when restricted mode hides ordinary navigation links. Genuine upstream and
license names are intentionally limited to this required-attribution surface,
license files, internal source, and no-secret technical documentation.

## Exact Release Binding

The tracked `config/mochirii-source.php` contains an invalid placeholder by
design. Local source checkouts therefore render no exact-release link.

`scripts/build-production-image.sh` permits an image build only from a clean
checkout whose lowercase 40-character revision equals the checked-out commit.
It passes that revision into `Dockerfile`, which rejects missing or malformed
input and replaces the placeholder inside the immutable image. The application
accepts only the canonical repository URL, exact Social subdirectory, and
validated revision before deriving commit, tree, archive, and license URLs.
Missing or invalid metadata fails closed and cannot render a source-release
claim.

Before production deployment, verify all of the following against the exact
reviewed image digest:

1. OCI source and revision labels match the protected-main commit.
2. `/site/open-source` identifies that same full commit and all four links
   resolve anonymously without redirects to authentication.
3. The repository archive contains `services/social`, its build scripts,
   dependency manifests, preserved `LICENSE`, and the Mōchirīī modifications
   used by the image.
4. No environment file, credential, runtime media, database/cache state,
   backup, private member data, signed URL, or private operational evidence is
   present in the source archive.
5. Counsel has approved the final notice and corresponding-source scope.

Do not deploy an image whose source page shows the unavailable state. The
corrective action is to rebuild from the exact reviewed commit, not to inject a
runtime source revision or hand-edit the running container.

## Repository License Boundary

`services/social/LICENSE` applies to the upstream-derived Social application
subtree. The repository root has no blanket license that overrides unrelated
source boundaries; every other path retains only the license notices present
with that path. Keep this distinction explicit in reviews and release records.
