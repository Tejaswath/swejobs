from __future__ import annotations

import unittest

from pipeline.jobtech import JobTechClient


class FakeResponse:
    status_code = 200

    def __init__(self, payload: object) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> object:
        return self.payload


class FakeSession:
    def __init__(self, payload: object) -> None:
        self.payload = payload
        self.calls: list[dict] = []
        self.headers: dict[str, str] = {}

    def get(self, url: str, **kwargs):
        self.calls.append({"url": url, **kwargs})
        return FakeResponse(self.payload)


class JobTechSearchTests(unittest.TestCase):
    def make_client(self, payload: object) -> tuple[JobTechClient, FakeSession]:
        client = JobTechClient(
            snapshot_url="https://example.test/snapshot",
            stream_url="https://example.test/stream",
            search_url="https://example.test/search",
            taxonomy_url="https://example.test/taxonomy",
            api_key=None,
            timeout_seconds=30,
        )
        session = FakeSession(payload)
        client.session = session  # type: ignore[assignment]
        return client, session

    def test_search_jobs_builds_targeted_window_query(self) -> None:
        client, session = self.make_client(
            {
                "total": {"value": 12},
                "hits": [{"id": "1"}, {"id": "2"}],
            }
        )

        result = client.search_jobs(
            published_after="2026-06-01T00:00:00+00:00",
            published_before="2026-06-02T00:00:00+00:00",
            q="junior",
            occupation_field="apaJ_2ja_LuF",
            limit=25,
            offset=50,
            sort="pubdate-asc",
        )

        self.assertEqual(result["total"], 12)
        self.assertEqual([row["id"] for row in result["hits"]], ["1", "2"])
        self.assertEqual(session.calls[0]["url"], "https://example.test/search")
        self.assertEqual(
            session.calls[0]["params"],
            {
                "occupation-field": "apaJ_2ja_LuF",
                "published-after": "2026-06-01T00:00:00",
                "published-before": "2026-06-02T00:00:00",
                "limit": 25,
                "offset": 50,
                "sort": "pubdate-asc",
                "q": "junior",
            },
        )

    def test_search_jobs_includes_optional_region(self) -> None:
        client, session = self.make_client({"total": {"value": 0}, "hits": []})

        client.search_jobs(
            published_after="2026-06-01T00:00:00Z",
            published_before="2026-06-02T00:00:00Z",
            limit=10,
            region="CifL_Rzy_Mku",
        )

        self.assertEqual(session.calls[0]["params"]["region"], "CifL_Rzy_Mku")

    def test_search_jobs_rejects_offset_above_api_limit(self) -> None:
        client, session = self.make_client({"total": {"value": 0}, "hits": []})

        with self.assertRaisesRegex(ValueError, "offset must be <= 2000"):
            client.search_jobs(
                published_after="2026-06-01T00:00:00Z",
                published_before="2026-06-02T00:00:00Z",
                limit=1,
                offset=2001,
            )

        self.assertEqual(session.calls, [])

    def test_search_jobs_filters_non_object_hits(self) -> None:
        client, _session = self.make_client({"total": 3, "hits": [{"id": "1"}, "bad", None]})

        result = client.search_jobs(
            published_after="2026-06-01T00:00:00Z",
            published_before="2026-06-02T00:00:00Z",
            limit=1000,
            offset=2000,
        )

        self.assertEqual(result["limit"], 100)
        self.assertEqual(result["offset"], 2000)
        self.assertEqual(result["hits"], [{"id": "1"}])


if __name__ == "__main__":
    unittest.main()
