import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type { SyncProgress } from "@/types/store";

/**
 * Tracks and broadcasts sync progress via Supabase Realtime.
 *
 * Frontend subscribes with:
 *   supabase.channel('sync:{storeId}')
 *     .on('broadcast', { event: 'sync_progress' }, (msg) => { ... })
 *     .subscribe()
 */
export class SyncProgressTracker {
  private storeId: string;
  private syncType: SyncProgress["sync_type"];
  private startedAt: string;
  private channelName: string;

  constructor(storeId: string, syncType: SyncProgress["sync_type"]) {
    this.storeId = storeId;
    this.syncType = syncType;
    this.startedAt = new Date().toISOString();
    this.channelName = `sync:${storeId}`;
  }

  async start(totalEstimate?: number): Promise<void> {
    await this.broadcast({
      store_id: this.storeId,
      sync_type: this.syncType,
      status: "running",
      total_estimate: totalEstimate ?? null,
      current_page: 0,
      records_synced: 0,
      started_at: this.startedAt,
    });

    logger.info("Sync started", {
      storeId: this.storeId,
      syncType: this.syncType,
      totalEstimate,
    });
  }

  async updatePage(
    currentPage: number,
    recordsSynced: number
  ): Promise<void> {
    await this.broadcast({
      store_id: this.storeId,
      sync_type: this.syncType,
      status: "running",
      total_estimate: null,
      current_page: currentPage,
      records_synced: recordsSynced,
      started_at: this.startedAt,
    });
  }

  async complete(totalRecords: number): Promise<void> {
    const progress: SyncProgress = {
      store_id: this.storeId,
      sync_type: this.syncType,
      status: "completed",
      total_estimate: totalRecords,
      current_page: 0,
      records_synced: totalRecords,
      started_at: this.startedAt,
    };

    await this.broadcast(progress);
    await this.persistProgress(progress);

    logger.info("Sync completed", {
      storeId: this.storeId,
      syncType: this.syncType,
      totalRecords,
    });
  }

  async fail(error: string): Promise<void> {
    const progress: SyncProgress = {
      store_id: this.storeId,
      sync_type: this.syncType,
      status: "failed",
      total_estimate: null,
      current_page: 0,
      records_synced: 0,
      started_at: this.startedAt,
      error,
    };

    await this.broadcast(progress);
    await this.persistProgress(progress);

    logger.error("Sync failed", {
      storeId: this.storeId,
      syncType: this.syncType,
      error,
    });
  }

  // ============================================================
  // Internal
  // ============================================================

  private async broadcast(progress: SyncProgress): Promise<void> {
    try {
      const channel = supabaseAdmin.channel(this.channelName);
      await channel.send({
        type: "broadcast",
        event: "sync_progress",
        payload: progress,
      });
      supabaseAdmin.removeChannel(channel);
    } catch (err) {
      // Broadcasting is best-effort — don't fail the sync over it
      logger.warn("Failed to broadcast sync progress", {
        storeId: this.storeId,
        error: err instanceof Error ? err.message : "Unknown",
      });
    }
  }

  /**
   * Persists the final sync state into stores.settings JSONB
   * so it survives page reloads.
   */
  private async persistProgress(progress: SyncProgress): Promise<void> {
    try {
      const { data: store } = await supabaseAdmin
        .from("stores")
        .select("settings")
        .eq("id", this.storeId)
        .single();

      const settings = (store?.settings as Record<string, unknown>) || {};
      const syncKey = `last_sync_${this.syncType}`;
      settings[syncKey] = progress;

      await supabaseAdmin
        .from("stores")
        .update({ settings })
        .eq("id", this.storeId);
    } catch {
      // Best-effort persistence
    }
  }
}
