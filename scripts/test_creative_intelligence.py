import copy
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from creative_intelligence import (APIError, Worker, action_value, add_evidence, allowed_media_url, build_patterns, creative_video_ids, vision_fingerprint,
                                   decision_support, enrich_snapshot, fatigue, metrics, objective_metric, sum_metrics, validate_assessment, window_dates)


def metric_row(spend=1000, impressions=10000, clicks=200, purchases=20, revenue=3000, frequency=2, leads=0):
    return metrics({"spend": spend, "impressions": impressions, "inline_link_clicks": clicks, "frequency": frequency,
                    "actions": [{"action_type": "omni_purchase", "value": purchases}, {"action_type": "lead", "value": leads}],
                    "action_values": [{"action_type": "omni_purchase", "value": revenue}]})


def ad(identity="1", **overrides):
    out = {"id": identity, "creative_id": "creative" + identity, "account_id": "acct", "campaign_id": "campaign", "adset_id": "adset", "currency": "INR",
           "objective": "OUTCOME_SALES", "optimization_goal": "OFFSITE_CONVERSIONS", "current": metric_row(), "previous": metric_row(),
           "daily": [{"date": f"2026-09-{d:02}", "impressions": 1500} for d in range(1, 15)], "format": "video", "is_dynamic": False,
           "visual_variants": 1, "copy": {"variants": 1}, "media": [{"kind": "video"}],
           "analysis": {"status": "ready", "confidence": "high", "hook_type": "pain_point", "hook_source": "creative_media", "offer_type": "course_program", "offer_source": "ad_copy", "visual_style": "presenter"}}
    out.update(overrides)
    out["metric"] = objective_metric(out, [out])
    return out


WINDOWS = {"current": {"from": "2026-09-08", "to": "2026-09-14"}, "previous": {"from": "2026-09-01", "to": "2026-09-07"}}


class CreativeEvidenceTests(unittest.TestCase):
    def test_post_video_reference_is_not_an_extra_delivered_variant(self):
        creative = {"video_id": "primary", "object_story_spec": {"video_data": {"video_id": "source-post"}}}
        self.assertEqual(creative_video_ids(creative), ["primary"])
        creative["asset_feed_spec"] = {"videos": [{"video_id": "primary"}, {"video_id": "variant"}]}
        self.assertEqual(creative_video_ids(creative), ["primary", "variant"])

    def test_unused_posters_do_not_trigger_another_paid_video_assessment(self):
        video = {"id": "v", "bytes": 1000, "kind": "video", "role": "creative"}
        poster = {"id": "p", "bytes": 100, "kind": "image", "role": "poster"}
        self.assertEqual(vision_fingerprint("c", [video], {}), vision_fingerprint("c", [video, poster], {}))
        self.assertNotEqual(vision_fingerprint("c", [video], {}), vision_fingerprint("c", [video], {"body": "changed"}))

    def test_overlapping_purchase_aliases_are_not_added(self):
        self.assertEqual(action_value([{"action_type": "omni_purchase", "value": 10}, {"action_type": "purchase", "value": 10}], "omni_purchase", "purchase"), 10)

    def test_zero_results_are_different_from_missing_purchase_value(self):
        self.assertEqual(metrics({"spend": 100})["roas"], 0)
        missing = metrics({"spend": 100, "actions": [{"action_type": "purchase", "value": 2}]})
        self.assertIsNone(missing["roas"])
        self.assertFalse(missing["revenue_reported"])

    def test_weighted_ratios_and_non_additive_reach(self):
        total = sum_metrics([metric_row(spend=100, revenue=1000, impressions=1000, clicks=100), metric_row(spend=900, revenue=900, impressions=9000, clicks=90)])
        self.assertAlmostEqual(total["roas"], 1.9)
        self.assertAlmostEqual(total["ctr"], 1.9)
        self.assertIsNone(total["frequency"])
        self.assertIsNone(total["reach"])

    def test_seven_complete_days_across_month_boundary(self):
        windows = window_dates("Asia/Kolkata", date(2026, 3, 3))
        self.assertEqual(windows["current"], {"from": "2026-02-24", "to": "2026-03-02"})
        self.assertEqual(windows["previous"]["to"], "2026-02-23")

    def test_lead_objective_does_not_rank_by_purchase_revenue(self):
        lead = ad(objective="OUTCOME_LEADS", current=metric_row(leads=100))
        self.assertEqual(lead["metric"]["result_key"], "leads")
        self.assertEqual(lead["metric"]["label"], "Cost / platform lead")

    def test_unsupported_messaging_outcome_is_not_assumed_to_be_sales(self):
        item = ad(objective="OUTCOME_ENGAGEMENT", optimization_goal="CONVERSATIONS")
        add_evidence([item], WINDOWS)
        self.assertEqual(item["performance"]["status"], "unsupported")

    def test_peers_require_same_adset_currency_and_objective(self):
        target = ad(current=metric_row(revenue=5000))
        wrong_currency = ad("2", currency="USD")
        wrong_adset = ad("3", adset_id="other")
        wrong_goal = ad("4", objective="OUTCOME_LEADS", current=metric_row(leads=100))
        add_evidence([target, wrong_currency, wrong_adset, wrong_goal], WINDOWS)
        self.assertEqual(target["performance"]["peer_count"], 0)
        self.assertEqual(target["performance"]["status"], "insufficient")

    def test_matching_peer_produces_an_explained_relative_comparison(self):
        target, other = ad(current=metric_row(revenue=5000)), ad("2")
        add_evidence([target, other], WINDOWS)
        self.assertEqual(target["performance"]["status"], "leading")
        self.assertAlmostEqual(target["performance"]["peer_value"], 3)
        self.assertIn("Observational", target["performance"]["reason"])

    def test_same_creative_and_low_volume_do_not_create_a_winner(self):
        target, duplicate = ad(current=metric_row(revenue=10000)), ad("2", creative_id="creative1")
        add_evidence([target, duplicate], WINDOWS)
        self.assertEqual(target["performance"]["status"], "insufficient")
        target = ad(current=metric_row(impressions=100, purchases=1, revenue=10000))
        add_evidence([target, ad("2")], WINDOWS)
        self.assertEqual(target["performance"]["status"], "insufficient")

    def test_attribution_settings_must_match(self):
        target, other = ad(attribution="7d"), ad("2", attribution="1d")
        add_evidence([target, other], WINDOWS)
        self.assertEqual(target["performance"]["peer_count"], 0)

    def test_combined_fatigue_requires_frequency_and_performance_deterioration(self):
        target = ad(current=metric_row(clicks=100, revenue=1500, frequency=3), previous=metric_row())
        evidence = fatigue(target, WINDOWS)
        self.assertEqual(evidence["status"], "possible")
        self.assertEqual(evidence["ctr_change"], -50)
        target["current"]["frequency"] = 2
        self.assertEqual(fatigue(target, WINDOWS)["status"], "watch")

    def test_new_ads_and_thin_conversion_windows_are_not_fatigued(self):
        target = ad(current=metric_row(clicks=100, revenue=1500, frequency=3), daily=[{"date": "2026-09-14", "impressions": 5000}])
        self.assertEqual(fatigue(target, WINDOWS)["status"], "insufficient")
        target = ad(current=metric_row(clicks=100, purchases=2, revenue=100, frequency=3))
        self.assertEqual(fatigue(target, WINDOWS)["status"], "insufficient")

    def test_fixed_media_patterns_do_not_credit_a_copy_variant(self):
        item = ad(is_dynamic=True, copy={"variants": 5})
        patterns = build_patterns([item])
        dimensions = {p["dimension"] for p in patterns}
        self.assertIn("hook_type", dimensions)
        self.assertIn("format", dimensions)
        self.assertNotIn("offer_type", dimensions)  # offer existed only in one caption

    def test_multi_asset_bundle_does_not_create_an_asset_winner(self):
        item = ad(format="flexible", is_dynamic=True, visual_variants=4)
        self.assertEqual(build_patterns([item]), [])

    def test_video_thumbnail_does_not_stand_in_for_video_observation(self):
        item = ad(media=[{"kind": "image"}])
        self.assertEqual({p["dimension"] for p in build_patterns([item])}, {"format"})

    def test_patterns_use_ratios_of_totals_and_separate_currencies(self):
        a, b, c = ad(current=metric_row(spend=100, revenue=1000)), ad("2", current=metric_row(spend=900, revenue=900)), ad("3", currency="USD")
        rows = [p for p in build_patterns([a, b, c]) if p["dimension"] == "format"]
        self.assertEqual(len(rows), 2)
        inr = next(p for p in rows if p["currency"] == "INR")
        self.assertAlmostEqual(inr["value"], 1.9)
        self.assertTrue(inr["eligible"])

    def test_media_hosts_reject_localhost_and_suffix_tricks(self):
        self.assertTrue(allowed_media_url("https://scontent.example.fbcdn.net/video.mp4?x=1"))
        for url in ["http://scontent.fbcdn.net/a", "https://fbcdn.net.evil.example/a", "https://localhost/a", "https://user@fbcdn.net/a", "https://fbcdn.net:8080/a"]:
            self.assertFalse(allowed_media_url(url), url)

    def test_incomplete_pagination_fails_without_claiming_complete_coverage(self):
        worker = Worker.__new__(Worker)
        worker.graph = lambda *args: {"data": [{"id": "1"}], "paging": {"next": "some-next-page"}}
        with self.assertRaises(APIError):
            worker.pages("endpoint", {})

    def test_invalid_vision_categories_and_extra_command_fields_are_not_trusted(self):
        valid = {"hook_text": "A hook", "offer_text": "An offer", "visual_description": "A presenter", "cta": "Learn more",
                 "hook_type": "direct", "offer_type": "course_program", "visual_style": "presenter", "confidence": "high",
                 "hook_source": "creative_media", "offer_source": "ad_copy", "strengths": [], "risks": [], "next_tests": [], "limitations": [], "evidence": [], "tests": [], "execute": "untrusted command"}
        self.assertNotIn("execute", validate_assessment(valid))
        valid["hook_type"] = "guaranteed_winner"
        with self.assertRaises(ValueError):
            validate_assessment(valid)

    def test_pattern_attribution_and_goal_are_not_blended(self):
        items = [ad(attribution="7d"), ad("2", attribution="1d"), ad("3", attribution="7d", optimization_goal="VALUE")]
        rows = [r for r in build_patterns(items) if r["dimension"] == "format"]
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(not r["eligible"] for r in rows))

    def test_thin_outcomes_can_surface_attention_without_fatigue(self):
        item = ad(status="ACTIVE", current=metric_row(clicks=80, purchases=2))
        add_evidence([item], WINDOWS)
        result = decision_support(item)
        self.assertEqual(result["action"], "collect_evidence")
        self.assertEqual(result["diagnostics"][0]["code"], "attention_decline")
        self.assertEqual(item["fatigue"]["status"], "insufficient")
        self.assertTrue(any("8 more purchases" in g for g in result["gaps"]))

    def test_inactive_leader_is_historical_not_a_scale_suggestion(self):
        item, peer = ad(status="CAMPAIGN_PAUSED", current=metric_row(revenue=6000)), ad("2")
        add_evidence([item, peer], WINDOWS)
        self.assertEqual(item["performance"]["status"], "leading")
        self.assertEqual(decision_support(item)["action"], "inactive")

    def test_poster_and_bundle_gaps_are_visible(self):
        item = ad(status="ACTIVE", media=[{"kind": "image", "role": "poster"}], copy={"variants": 4})
        add_evidence([item], WINDOWS)
        snapshot = enrich_snapshot({"ads": [item]})
        d = snapshot["ads"][0]["decision"]
        self.assertEqual(d["media_scope"], "poster")
        self.assertTrue(any("Original creative media" in g for g in d["gaps"]))
        self.assertTrue(any("Variant-level" in g for g in d["gaps"]))

    def test_failed_upgrade_preserves_observations_and_stops_on_quota(self):
        items = [ad(status="ACTIVE", name="Control"), ad("2", status="ACTIVE", name="Other")]
        add_evidence(items, WINDOWS)
        prior = copy.deepcopy(items[0]["analysis"])
        calls = []
        def fail(item):
            calls.append(item["id"])
            raise APIError("HTTP 429: quota exceeded")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "latest.json").write_text(json.dumps({"ads": items}))
            worker = Worker.__new__(Worker)
            worker.root, worker.job_file = root, root / "job.json"
            worker.model, worker.batch_size = "gemini-test", 8
            worker.token, worker.key = "", ""
            worker.job, worker.assess = {"errors": []}, fail
            worker.analyze()
            result = json.loads((root / "latest.json").read_text())
            self.assertEqual(calls, ["1"])
            updated = result["ads"][0]["analysis"]
            self.assertEqual(updated.pop("upgrade_error"), "HTTP 429: quota exceeded")
            self.assertEqual(updated, prior)
            self.assertEqual(result["ads"][1]["analysis"], items[1]["analysis"])
            self.assertEqual(worker.job["status"], "failed")

    def test_evidence_references_and_media_timing_are_validated(self):
        valid = {"hook_text": "A hook", "offer_text": "An offer", "visual_description": "A presenter", "cta": "Learn more",
                 "hook_type": "direct", "offer_type": "course_program", "visual_style": "presenter", "confidence": "high",
                 "hook_source": "creative_media", "offer_source": "ad_copy", "strengths": [], "risks": [], "next_tests": [], "limitations": [],
                 "evidence": [{"id": "E1", "source": "creative_media", "asset_index": 1, "at_seconds": None, "observation": "The offer is in small type."}],
                 "tests": [{"variable": "visual_hierarchy", "change": "Increase the offer font", "hypothesis": "Test message legibility", "keep_constant": "Offer, CTA and audience", "diagnostic": "objective_outcome", "evidence_ids": ["E1"]}]}
        image = [{"kind": "image", "role": "poster"}]
        self.assertEqual(validate_assessment(valid, image)["next_tests"], ["Increase the offer font"])
        valid["tests"][0]["evidence_ids"] = ["E2"]
        with self.assertRaises(ValueError): validate_assessment(valid, image)
        valid["tests"][0]["evidence_ids"] = ["E1"]
        valid["evidence"][0]["at_seconds"] = 2
        with self.assertRaises(ValueError): validate_assessment(valid, image)
        self.assertEqual(validate_assessment(valid, [{"kind": "video", "duration": 4}])["evidence"][0]["at_seconds"], 2)
        with self.assertRaises(ValueError): validate_assessment(valid, [{"kind": "video", "duration": 1}])


if __name__ == "__main__":
    unittest.main()
