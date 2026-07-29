const LOWERCASE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function gallerySocialDerivativeStoragePath(
  submissionId: string,
  revisionId: string,
): string {
  if (
    !LOWERCASE_UUID_RE.test(submissionId) ||
    !LOWERCASE_UUID_RE.test(revisionId)
  ) {
    throw new Error(
      "A lowercase submission and derivative revision id are required.",
    );
  }
  return `_social/submissions/${submissionId}/${revisionId}.jpg`;
}

export function isGallerySocialDerivativeStoragePath(
  storagePath: unknown,
  submissionId: unknown,
): boolean {
  if (
    typeof storagePath !== "string" ||
    typeof submissionId !== "string" ||
    !LOWERCASE_UUID_RE.test(submissionId)
  ) return false;

  const prefix = `_social/submissions/${submissionId}/`;
  if (!storagePath.startsWith(prefix) || !storagePath.endsWith(".jpg")) {
    return false;
  }
  const revisionId = storagePath.slice(prefix.length, -4);
  return LOWERCASE_UUID_RE.test(revisionId) &&
    storagePath === gallerySocialDerivativeStoragePath(
        submissionId,
        revisionId,
      );
}
