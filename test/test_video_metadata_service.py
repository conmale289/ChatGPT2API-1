import unittest

from services.video_metadata_service import cover_proxy_url


class VideoMetadataServiceTests(unittest.TestCase):
    def test_cover_proxy_url_encodes_remote_cover(self) -> None:
        url = "https://i0.hdslb.com/bfs/archive/demo.jpg?x=1&y=2"
        proxied = cover_proxy_url(url)
        self.assertTrue(proxied.startswith("/api/video/cover?url="))
        self.assertIn("https%3A%2F%2Fi0.hdslb.com%2Fbfs%2Farchive%2Fdemo.jpg", proxied)


if __name__ == "__main__":
    unittest.main()
