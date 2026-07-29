export const RAFFLE_DRAW_ALGORITHM_VERSION =
  "mochirii-weighted-without-replacement-v1";

export type FrozenEntry = {
  memberId: string;
  entryCount: number;
};

export type FrozenLedgerRow = FrozenEntry & {
  pseudonymousMemberId: string;
  firstOrdinal: number;
  lastOrdinal: number;
};

export type RaffleSelection = {
  memberId: string;
  pseudonymousMemberId: string;
  entryOrdinal: number;
  selectionOrder: number;
  kind: "paid_winner" | "honor" | "alternate";
  alternateRank: number | null;
};

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return owned.buffer;
}

export function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error("Seed must contain exactly 32 bytes of hexadecimal data.");
  }
  return Uint8Array.from(
    value.match(/.{2}/g) || [],
    (pair) => Number.parseInt(pair, 16),
  );
}

export function randomHex(byteLength = 32): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < 16 || byteLength > 64) {
    throw new Error("Random byte length is outside the supported range.");
  }
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", ownedArrayBuffer(bytes)),
    ),
  );
}

export async function pseudonymousMemberId(
  memberId: string,
  ledgerSalt: string,
): Promise<string> {
  return await sha256Hex(`${ledgerSalt}:${memberId}`);
}

export async function buildFrozenLedger(
  entries: FrozenEntry[],
  ledgerSalt: string,
): Promise<FrozenLedgerRow[]> {
  if (ledgerSalt.length < 32) throw new Error("Ledger salt is too short.");
  const memberIds = new Set<string>();
  const rows: Array<FrozenEntry & { pseudonymousMemberId: string }> = [];

  for (const entry of entries) {
    if (!entry.memberId || memberIds.has(entry.memberId)) {
      throw new Error("Frozen ledger member IDs must be unique.");
    }
    if (
      !Number.isInteger(entry.entryCount) || entry.entryCount < 1 ||
      entry.entryCount > 10
    ) {
      throw new Error("Frozen entry count must be between 1 and 10.");
    }
    memberIds.add(entry.memberId);
    rows.push({
      ...entry,
      pseudonymousMemberId: await pseudonymousMemberId(
        entry.memberId,
        ledgerSalt,
      ),
    });
  }

  // Pseudonyms are lowercase SHA-256 hex. Explicit code-unit comparison is
  // identical to PostgreSQL COLLATE "C" and cannot drift with an ICU locale.
  rows.sort((left, right) =>
    left.pseudonymousMemberId === right.pseudonymousMemberId
      ? 0
      : left.pseudonymousMemberId < right.pseudonymousMemberId
      ? -1
      : 1
  );
  let nextOrdinal = 1;
  return rows.map((row) => {
    const firstOrdinal = nextOrdinal;
    const lastOrdinal = firstOrdinal + row.entryCount - 1;
    nextOrdinal = lastOrdinal + 1;
    return { ...row, firstOrdinal, lastOrdinal };
  });
}

export async function frozenLedgerHash(
  ledger: FrozenLedgerRow[],
): Promise<string> {
  const canonical = ledger.map((row) => ({
    pseudonymousMemberId: row.pseudonymousMemberId,
    entryCount: row.entryCount,
    firstOrdinal: row.firstOrdinal,
    lastOrdinal: row.lastOrdinal,
  }));
  return await sha256Hex(JSON.stringify(canonical));
}

class DigestCounterStream {
  readonly #seed: Uint8Array;
  #counter = 0n;
  #buffer = new Uint8Array();

  constructor(seed: Uint8Array) {
    this.#seed = seed.slice();
  }

  async read(byteLength: number): Promise<Uint8Array> {
    while (this.#buffer.length < byteLength) {
      const counterBytes = new Uint8Array(8);
      new DataView(counterBytes.buffer).setBigUint64(0, this.#counter, false);
      this.#counter += 1n;
      const input = new Uint8Array(this.#seed.length + counterBytes.length);
      input.set(this.#seed);
      input.set(counterBytes, this.#seed.length);
      const block = new Uint8Array(
        await crypto.subtle.digest("SHA-256", ownedArrayBuffer(input)),
      );
      const merged = new Uint8Array(this.#buffer.length + block.length);
      merged.set(this.#buffer);
      merged.set(block, this.#buffer.length);
      this.#buffer = merged;
    }

    const result = this.#buffer.slice(0, byteLength);
    this.#buffer = this.#buffer.slice(byteLength);
    return result;
  }
}

async function uniformIndex(
  stream: DigestCounterStream,
  upperExclusive: number,
): Promise<number> {
  if (!Number.isSafeInteger(upperExclusive) || upperExclusive <= 0) {
    throw new Error("Uniform range must be a positive safe integer.");
  }

  const upper = BigInt(upperExclusive);
  let byteLength = 1;
  let range = 256n;
  while (range < upper) {
    byteLength += 1;
    range *= 256n;
  }
  const acceptanceLimit = range - (range % upper);

  while (true) {
    const bytes = await stream.read(byteLength);
    let candidate = 0n;
    for (const byte of bytes) candidate = candidate * 256n + BigInt(byte);
    if (candidate < acceptanceLimit) return Number(candidate % upper);
  }
}

export async function drawRaffle(
  ledger: FrozenLedgerRow[],
  seedHex: string,
): Promise<RaffleSelection[]> {
  const remaining = ledger.map((row) => ({ ...row }));
  const stream = new DigestCounterStream(hexToBytes(seedHex));
  const selections: RaffleSelection[] = [];

  while (remaining.length) {
    const remainingEntries = remaining.reduce(
      (sum, row) => sum + row.entryCount,
      0,
    );
    const selectedOffset = await uniformIndex(stream, remainingEntries);
    let cursor = 0;
    let selectedIndex = -1;
    let ordinalWithinMember = 0;

    for (let index = 0; index < remaining.length; index += 1) {
      const row = remaining[index];
      if (selectedOffset < cursor + row.entryCount) {
        selectedIndex = index;
        ordinalWithinMember = selectedOffset - cursor;
        break;
      }
      cursor += row.entryCount;
    }

    if (selectedIndex < 0) {
      throw new Error("Random selection did not map to a ledger row.");
    }
    const [selected] = remaining.splice(selectedIndex, 1);
    const selectionOrder = selections.length + 1;
    const kind = selectionOrder === 1
      ? "paid_winner"
      : selectionOrder <= 3
      ? "honor"
      : "alternate";
    selections.push({
      memberId: selected.memberId,
      pseudonymousMemberId: selected.pseudonymousMemberId,
      entryOrdinal: selected.firstOrdinal + ordinalWithinMember,
      selectionOrder,
      kind,
      alternateRank: kind === "alternate" ? selectionOrder - 3 : null,
    });
  }

  return selections;
}
