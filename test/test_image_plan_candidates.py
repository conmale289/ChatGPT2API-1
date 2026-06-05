from __future__ import annotations

import unittest

from services.protocol.conversation import ConversationRequest, codex_image_size_for_request, image_plan_candidates


class ImagePlanCandidatesTests(unittest.TestCase):
    def test_high_resolution_prefers_paid_accounts_before_auto_fallback(self):
        request = ConversationRequest(model="gpt-image-2", resolution="4k")

        self.assertEqual(image_plan_candidates(request), ["Pro", "Plus", None])

    def test_explicit_plan_overrides_resolution_preference(self):
        request = ConversationRequest(model="gpt-image-2", resolution="4k", plan_type="Plus")

        self.assertEqual(image_plan_candidates(request), ["Plus"])

    def test_default_resolution_uses_auto_pool(self):
        request = ConversationRequest(model="gpt-image-2", resolution="")

        self.assertEqual(image_plan_candidates(request), [None])

    def test_free_user_policy_uses_free_pool_only(self):
        request = ConversationRequest(model="gpt-image-2", resolution="", allowed_plan_types=("free",))

        self.assertEqual(image_plan_candidates(request), ["free"])

    def test_premium_user_policy_uses_paid_pool_only(self):
        request = ConversationRequest(model="gpt-image-2", resolution="", allowed_plan_types=("Pro", "Plus", "Team"))

        self.assertEqual(image_plan_candidates(request), ["Pro", "Plus", "Team"])

    def test_premium_high_resolution_policy_keeps_paid_preference(self):
        request = ConversationRequest(model="gpt-image-2", resolution="4k", allowed_plan_types=("Pro", "Plus", "Team"))

        self.assertEqual(image_plan_candidates(request), ["Pro", "Plus", "Team"])

    def test_codex_size_maps_high_resolution_and_aspect_ratio(self):
        self.assertEqual(
            codex_image_size_for_request(ConversationRequest(model="gpt-image-2", resolution="4k", size="16:9")),
            "3840x2160",
        )
        self.assertEqual(
            codex_image_size_for_request(ConversationRequest(model="gpt-image-2", resolution="4k", size="9:16")),
            "2160x3840",
        )
        self.assertEqual(
            codex_image_size_for_request(ConversationRequest(model="gpt-image-2", resolution="2k", size="1:1")),
            "2048x2048",
        )

    def test_codex_size_ignores_default_resolution(self):
        self.assertIsNone(codex_image_size_for_request(ConversationRequest(model="gpt-image-2", resolution="")))


if __name__ == "__main__":
    unittest.main()
