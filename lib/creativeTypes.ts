/** Creative Intelligence's file contract. No credentials or remote asset URLs. */
export interface CreativeMetrics {
  spend: number;
  impressions: number;
  reach: number | null;
  frequency: number | null;
  link_clicks: number;
  purchases: number;
  revenue: number;
  revenue_reported: boolean;
  leads: number;
  landing_page_views: number;
  engagements: number;
  video_views: number;
  ctr: number | null;
  cpc: number | null;
  roas: number | null;
}

export interface CreativeAsset {
  id: string;
  kind: "image" | "video";
  mime_type: string;
  bytes: number;
  role: "creative" | "poster";
  duration?: number;
}

export interface CreativeAssessment {
  status: "pending" | "ready" | "error";
  model?: string;
  analyzed_at?: string;
  error?: string;
  upgrade_error?: string;
  confidence?: "low" | "medium" | "high";
  hook_type?: string;
  hook_text?: string;
  offer_type?: string;
  offer_text?: string;
  visual_style?: string;
  visual_description?: string;
  cta?: string;
  strengths?: string[];
  risks?: string[];
  next_tests?: string[];
  limitations?: string[];
  evidence_scope?: string;
  observation_schema?: string;
  hook_source?: "creative_media" | "ad_copy" | "unclear";
  offer_source?: "creative_media" | "ad_copy" | "unclear";
  evidence?: { id: string; source: "creative_media" | "ad_copy"; asset_index: number; at_seconds: number | null; observation: string }[];
  tests?: { variable: string; change: string; hypothesis: string; keep_constant: string; diagnostic: string; evidence_ids: string[] }[];
  usage?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}

export interface CreativeDecision {
  action: "inactive" | "refresh_test" | "investigate" | "retain_control" | "test" | "collect_evidence";
  label: string;
  priority: number;
  why: string;
  gaps: string[];
  media_scope: "video" | "images" | "poster" | "missing";
  diagnostics: { code: string; text: string }[];
  test_plan: { primary_metric: string; baseline: number | null; control_ad_id: string; guardrail: string };
}

export interface CreativeAd {
  id: string;
  creative_id: string;
  name: string;
  account_id: string;
  account_name: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  currency: string;
  timezone: string;
  objective: string;
  optimization_goal: string;
  status: string;
  format: "image" | "video" | "carousel" | "flexible" | "unknown";
  is_dynamic: boolean;
  visual_variants: number;
  copy: { body: string; title: string; cta: string; variants: number };
  media: CreativeAsset[];
  media_note: string;
  fingerprint: string;
  current: CreativeMetrics;
  previous: CreativeMetrics;
  daily: { date: string; spend: number; impressions: number; link_clicks: number; purchases: number; revenue: number; leads: number }[];
  metric: { key: string; label: string; unit: "currency" | "ratio"; higher_is_better: boolean; result_key: string };
  performance: {
    status: "leading" | "trailing" | "in_line" | "insufficient" | "unsupported";
    value: number | null;
    peer_value: number | null;
    delta_pct: number | null;
    peer_count: number;
    reason: string;
  };
  fatigue: {
    status: "possible" | "watch" | "stable" | "insufficient";
    reasons: string[];
    ctr_change: number | null;
    performance_change: number | null;
    frequency_change: number | null;
  };
  analysis: CreativeAssessment;
  decision?: CreativeDecision;
}

export interface CreativePattern {
  attribution?: string;
  optimization_goal?: string;
  timezone?: string;
  campaign_id: string;
  account_id: string;
  currency: string;
  metric_key: string;
  metric_label: string;
  higher_is_better: boolean;
  dimension: "hook_type" | "offer_type" | "format" | "visual_style";
  label: string;
  ads: number;
  spend: number;
  impressions: number;
  results: number;
  value: number | null;
  eligible: boolean;
  examples: string[];
}

export interface CreativeSnapshot {
  schema_version: 1;
  generated_at: string;
  analyzed_at: string | null;
  windows: { current: { from: string; to: string }; previous: { from: string; to: string } };
  coverage: {
    configured_accounts: number;
    reporting_accounts: number;
    accounts: {
      id: string; name: string; currency?: string; timezone?: string;
      status: "ok" | "error"; error?: string;
      ads_total?: number; ads_loaded?: number; spend_total?: number; spend_loaded?: number;
      windows?: CreativeSnapshot["windows"];
    }[];
  };
  ads: CreativeAd[];
  patterns: CreativePattern[];
  notes: string[];
  rules: { min_impressions: number; min_results: number; relative_change_pct: number; frequency_floor: number };
}

export interface CreativeJob {
  id: string;
  action: "refresh" | "analyze";
  status: "running" | "complete" | "partial" | "failed" | "interrupted";
  phase: string;
  started_at: string;
  updated_at: string;
  completed: number;
  total: number;
  errors: string[];
  pid: number | null;
  ad_id?: string;
}

export interface CreativeBrief {
  id: string;
  created_at: string;
  title: string;
  source_ad_id: string;
  source_snapshot: string;
  markdown: string;
  report_path: string;
  queued_id?: string;
}

export interface CreativeState {
  snapshot: CreativeSnapshot | null;
  job: CreativeJob | null;
  briefs: CreativeBrief[];
  config: {
    meta_configured: boolean;
    gemini_configured: boolean;
    gemini_source: "ARGUS .env" | "Environment" | "Ads Generator Kit" | "Not configured";
    model: string;
    batch_size: number;
    max_ads: number;
    observation_schema: string;
  };
}
