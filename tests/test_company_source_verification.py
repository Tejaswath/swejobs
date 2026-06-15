from __future__ import annotations

import unittest
from unittest.mock import patch

from pipeline.ingest import IngestionPipeline
from pipeline.sources.base import CompanyFeed, FeedFetchResult


class CompanySourceVerificationTests(unittest.TestCase):
    def test_configured_feed_is_verifiable_without_registry_duplicate(self) -> None:
        pipeline = object.__new__(IngestionPipeline)
        pipeline.company_feed_config_path = "ignored"
        pipeline.request_timeout_seconds = 5
        pipeline._fetch_company_feed = lambda feed, max_rows, max_http: FeedFetchResult(
            rows=[
                {
                    "id": "1",
                    "headline": "Software Engineer",
                    "description": "Build software",
                    "source_url": "https://example.test/jobs/1",
                    "publication_date": "2026-06-14",
                }
            ],
            http_requests=1,
            http_status=200,
            endpoint_url="https://example.test/api",
        )
        pipeline._prepare_records = lambda rows: ([], {}, 1)
        feed = CompanyFeed(
            feed_key="example_greenhouse",
            provider="greenhouse",
            slug_or_url="example",
            company_canonical="example",
            display_name="Example",
            enabled=False,
            priority=1,
            location_filters=("Stockholm", "Sweden"),
            keywords_any=("software",),
        )

        with (
            patch("pipeline.ingest.company_registry_map", return_value={}),
            patch("pipeline.ingest.load_company_feeds", return_value=[feed]),
        ):
            report = pipeline.verify_company_sources(company_names=["example"], max_rows=1, max_http_per_provider=1)

        self.assertEqual(len(report["companies"]), 1)
        self.assertEqual(report["companies"][0]["recommended_status"], "connected")
        self.assertEqual(report["companies"][0]["recommended_provider"], "greenhouse")


if __name__ == "__main__":
    unittest.main()
