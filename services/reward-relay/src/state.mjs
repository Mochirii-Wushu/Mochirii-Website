import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class RelayState {
  constructor(path) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS replay_nonces (
        nonce TEXT PRIMARY KEY,
        expires_at_ms INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS rate_windows (
        bucket TEXT NOT NULL,
        window_start_ms INTEGER NOT NULL,
        count INTEGER NOT NULL CHECK (count >= 0),
        PRIMARY KEY (bucket, window_start_ms)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS order_bindings (
        external_id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL UNIQUE,
        draw_result_id TEXT NOT NULL UNIQUE,
        reward_value_cents INTEGER NOT NULL CHECK (reward_value_cents > 0),
        request_hash TEXT NOT NULL,
        request_json TEXT NOT NULL,
        environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
        provider_order_id TEXT UNIQUE,
        provider_reward_id TEXT UNIQUE,
        sanitized_status TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('reserved', 'uncertain', 'terminal', 'succeeded')),
        attempted_at_ms INTEGER,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS relay_control (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        orders_suspended INTEGER NOT NULL CHECK (orders_suspended IN (0, 1)),
        reason_code TEXT,
        updated_at_ms INTEGER NOT NULL
      ) STRICT;
      INSERT OR IGNORE INTO relay_control(singleton, orders_suspended, reason_code, updated_at_ms)
      VALUES (1, 0, NULL, 0);
      CREATE TABLE IF NOT EXISTS reconciliation_runs (
        id INTEGER PRIMARY KEY,
        started_at_ms INTEGER NOT NULL,
        completed_at_ms INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('clean', 'incident')),
        provider_order_count INTEGER NOT NULL,
        local_issued_count INTEGER NOT NULL,
        provider_only_count INTEGER NOT NULL,
        upstream_missing_count INTEGER NOT NULL,
        mismatch_count INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS reward_link_limits (
        reward_reference TEXT PRIMARY KEY,
        generation_count INTEGER NOT NULL CHECK (generation_count >= 0 AND generation_count <= 5),
        last_generated_at_ms INTEGER,
        updated_at_ms INTEGER NOT NULL,
        FOREIGN KEY (reward_reference) REFERENCES order_bindings(provider_reward_id)
      ) STRICT;
    `);
    const orderBindingColumns = new Set(this.database.prepare("PRAGMA table_info(order_bindings)").all().map((column) => column.name));
    for (const requiredColumn of ["cycle_id", "reward_value_cents"]) {
      if (!orderBindingColumns.has(requiredColumn)) {
        this.database.close();
        throw new Error("relay_state_schema_upgrade_required");
      }
    }
    const uniqueBindingColumns = new Set(
      this.database.prepare('SELECT name FROM pragma_index_list(\'order_bindings\') WHERE "unique" = 1').all()
        .flatMap((index) => {
          const columns = this.database.prepare("SELECT name FROM pragma_index_info(?) ORDER BY seqno").all(index.name);
          return columns.length === 1 ? [columns[0].name] : [];
        }),
    );
    for (const requiredUniqueColumn of ["provider_order_id", "provider_reward_id"]) {
      if (!uniqueBindingColumns.has(requiredUniqueColumn)) {
        this.database.close();
        throw new Error("relay_state_schema_upgrade_required");
      }
    }
    this.consumeNonceStatement = this.database.prepare("INSERT OR IGNORE INTO replay_nonces(nonce, expires_at_ms, created_at_ms) VALUES (?, ?, ?)");
  }

  consumeNonce(nonce, expiresAtMs, nowMs) {
    this.database.prepare("DELETE FROM replay_nonces WHERE expires_at_ms <= ?").run(nowMs);
    return this.consumeNonceStatement.run(nonce, expiresAtMs, nowMs).changes === 1;
  }

  consumeRate(bucket, nowMs, limit, windowMs = 60_000) {
    const windowStart = Math.floor(nowMs / windowMs) * windowMs;
    this.database.prepare("DELETE FROM rate_windows WHERE window_start_ms < ?").run(nowMs - Math.max(windowMs * 2, 1_800_000));
    return this.#transaction(() => {
      const current = this.database.prepare("SELECT count FROM rate_windows WHERE bucket = ? AND window_start_ms = ?").get(bucket, windowStart);
      if (current && current.count >= limit) return false;
      this.database.prepare(`
        INSERT INTO rate_windows(bucket, window_start_ms, count) VALUES (?, ?, 1)
        ON CONFLICT(bucket, window_start_ms) DO UPDATE SET count = count + 1
      `).run(bucket, windowStart);
      return true;
    });
  }

  reserveOrder({ externalId, cycleId, drawResultId, rewardValueCents, maximumCycleCostCents, requestHash, requestJson, environment, nowMs }) {
    return this.#transaction(() => {
      const byExternal = this.getOrderByExternalId(externalId);
      const byCycle = this.getOrderByCycleId(cycleId);
      const byDraw = this.getOrderByDrawResultId(drawResultId);
      const existingBindings = [byExternal, byCycle, byDraw].filter(Boolean);
      const existing = existingBindings[0];
      if (existing) {
        if (
          existingBindings.some((binding) => binding.external_id !== existing.external_id) ||
          existing.external_id !== externalId ||
          existing.cycle_id !== cycleId ||
          existing.draw_result_id !== drawResultId ||
          existing.reward_value_cents !== rewardValueCents ||
          existing.request_hash !== requestHash
        ) {
          return { outcome: "conflict", binding: existing };
        }
        return { outcome: "existing", binding: existing };
      }
      const committedCycleCost = this.database.prepare(`
        SELECT COALESCE(SUM(reward_value_cents), 0) AS total
        FROM order_bindings
        WHERE cycle_id = ?
      `).get(cycleId).total;
      if (
        !Number.isSafeInteger(rewardValueCents) ||
        !Number.isSafeInteger(maximumCycleCostCents) ||
        rewardValueCents <= 0 ||
        committedCycleCost + rewardValueCents > maximumCycleCostCents
      ) return { outcome: "cycle_budget_exceeded", binding: null };
      this.database.prepare(`
        INSERT INTO order_bindings(
          external_id, cycle_id, draw_result_id, reward_value_cents, request_hash, request_json, environment,
          sanitized_status, state, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', 'reserved', ?, ?)
      `).run(externalId, cycleId, drawResultId, rewardValueCents, requestHash, requestJson, environment, nowMs, nowMs);
      return { outcome: "created", binding: this.getOrderByExternalId(externalId) };
    });
  }

  markOrderUncertain(externalId, nowMs) {
    this.database.prepare(`
      UPDATE order_bindings
      SET state = 'uncertain', sanitized_status = 'uncertain', attempted_at_ms = ?, updated_at_ms = ?
      WHERE external_id = ? AND state != 'succeeded'
    `).run(nowMs, nowMs, externalId);
  }

  markOrderTerminal(externalId, sanitizedStatus, nowMs) {
    this.database.prepare(`
      UPDATE order_bindings
      SET state = 'terminal', sanitized_status = ?, updated_at_ms = ?
      WHERE external_id = ? AND state != 'succeeded'
    `).run(sanitizedStatus, nowMs, externalId);
  }

  completeOrder(externalId, { orderReference, rewardReference, sanitizedStatus }, nowMs) {
    const outcome = this.#transaction(() => {
      let result;
      try {
        result = this.database.prepare(`
          UPDATE order_bindings
          SET provider_order_id = ?, provider_reward_id = ?, sanitized_status = ?, state = 'succeeded', updated_at_ms = ?
          WHERE external_id = ?
            AND (
              (provider_order_id IS NULL AND provider_reward_id IS NULL)
              OR (provider_order_id = ? AND provider_reward_id = ?)
            )
        `).run(
          orderReference,
          rewardReference,
          sanitizedStatus,
          nowMs,
          externalId,
          orderReference,
          rewardReference,
        );
      } catch (error) {
        if (!isUniqueConstraintConflict(error)) throw error;
        this.suspendOrders("provider_identifier_conflict", nowMs);
        return { status: "conflict", binding: null };
      }
      if (result.changes !== 1) {
        const binding = this.getOrderByExternalId(externalId);
        if (!binding) return { status: "missing", binding: null };
        this.suspendOrders("provider_identifier_conflict", nowMs);
        return { status: "conflict", binding };
      }
      return { status: "completed", binding: this.getOrderByExternalId(externalId) };
    });
    if (outcome.status === "missing") throw new Error("missing_order_binding");
    if (outcome.status === "conflict") throw providerIdentifierConflict();
    return outcome.binding;
  }

  getOrderByExternalId(externalId) {
    return this.database.prepare("SELECT * FROM order_bindings WHERE external_id = ?").get(externalId) || null;
  }

  getOrderByDrawResultId(drawResultId) {
    return this.database.prepare("SELECT * FROM order_bindings WHERE draw_result_id = ?").get(drawResultId) || null;
  }

  getOrderByCycleId(cycleId) {
    return this.database.prepare("SELECT * FROM order_bindings WHERE cycle_id = ?").get(cycleId) || null;
  }

  getOrderByRewardReference(rewardReference) {
    return this.database.prepare("SELECT * FROM order_bindings WHERE provider_reward_id = ?").get(rewardReference) || null;
  }

  consumeLinkGeneration(rewardReference, nowMs, intervalMs = 15 * 60_000, maximumCount = 5) {
    return this.#transaction(() => {
      const binding = this.getOrderByRewardReference(rewardReference);
      if (!binding || binding.state !== "succeeded") return { ok: false, reason: "unknown" };
      const current = this.database.prepare("SELECT generation_count, last_generated_at_ms FROM reward_link_limits WHERE reward_reference = ?").get(rewardReference);
      if (current?.generation_count >= maximumCount) return { ok: false, reason: "maximum" };
      if (current?.last_generated_at_ms != null && current.last_generated_at_ms + intervalMs > nowMs) {
        return { ok: false, reason: "interval", retryAfterMs: current.last_generated_at_ms + intervalMs - nowMs };
      }
      this.database.prepare(`
        INSERT INTO reward_link_limits(reward_reference, generation_count, last_generated_at_ms, updated_at_ms)
        VALUES (?, 1, ?, ?)
        ON CONFLICT(reward_reference) DO UPDATE SET
          generation_count = generation_count + 1,
          last_generated_at_ms = excluded.last_generated_at_ms,
          updated_at_ms = excluded.updated_at_ms
      `).run(rewardReference, nowMs, nowMs);
      return { ok: true };
    });
  }

  unlockRewardLink(rewardReference, nowMs) {
    const binding = this.getOrderByRewardReference(rewardReference);
    if (!binding || binding.state !== "succeeded") return false;
    this.database.prepare(`
      INSERT INTO reward_link_limits(reward_reference, generation_count, last_generated_at_ms, updated_at_ms)
      VALUES (?, 0, NULL, ?)
      ON CONFLICT(reward_reference) DO UPDATE SET
        generation_count = 0,
        last_generated_at_ms = NULL,
        updated_at_ms = excluded.updated_at_ms
    `).run(rewardReference, nowMs);
    return true;
  }

  listOrderBindings() {
    return this.database.prepare("SELECT * FROM order_bindings ORDER BY created_at_ms ASC").all();
  }

  recordReconciliation(result) {
    this.database.prepare(`
      INSERT INTO reconciliation_runs(
        started_at_ms, completed_at_ms, status, provider_order_count, local_issued_count,
        provider_only_count, upstream_missing_count, mismatch_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      result.startedAtMs,
      result.completedAtMs,
      result.status,
      result.providerOrderCount,
      result.localIssuedCount,
      result.providerOnlyCount,
      result.upstreamMissingCount,
      result.mismatchCount,
    );
  }

  suspendOrders(reasonCode, nowMs) {
    const safeReason = /^[a-z][a-z0-9_]{0,39}$/.test(String(reasonCode)) ? String(reasonCode) : "integrity_stop";
    this.database.prepare("UPDATE relay_control SET orders_suspended = 1, reason_code = ?, updated_at_ms = ? WHERE singleton = 1").run(safeReason, nowMs);
  }

  getControl() {
    const row = this.database.prepare("SELECT orders_suspended, reason_code, updated_at_ms FROM relay_control WHERE singleton = 1").get();
    return { ordersSuspended: row.orders_suspended === 1, reasonCode: row.reason_code, updatedAtMs: row.updated_at_ms };
  }

  clearSuspension(expectedReasonCode, nowMs) {
    const control = this.getControl();
    if (!control.ordersSuspended || !expectedReasonCode || control.reasonCode !== expectedReasonCode) return false;
    return this.database.prepare("UPDATE relay_control SET orders_suspended = 0, reason_code = NULL, updated_at_ms = ? WHERE singleton = 1").run(nowMs).changes === 1;
  }

  close() {
    this.database.close();
  }

  #transaction(callback) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function isUniqueConstraintConflict(error) {
  return String(error?.code || "") === "ERR_SQLITE_CONSTRAINT_UNIQUE" ||
    /UNIQUE constraint failed: order_bindings\.provider_(?:order|reward)_id/i.test(String(error?.message || ""));
}

function providerIdentifierConflict() {
  const error = new Error("provider_identifier_conflict");
  error.code = "provider_identifier_conflict";
  return error;
}
