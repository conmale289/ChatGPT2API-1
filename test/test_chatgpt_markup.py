from __future__ import annotations

import unittest

from services.protocol.chatgpt_markup import (
    CLOSE,
    FIELD_SEP,
    ITEM_SEP,
    OPEN,
    collect_references,
    sanitize,
)
from services.protocol.conversation import ConversationState, iter_conversation_payloads


def _entity(slug: str, name: str, sub: str) -> str:
    return f'{OPEN}entity["{slug}","{name}","{sub}"]{CLOSE}'


def _cite(*tokens: str) -> str:
    return f"{OPEN}cite{FIELD_SEP}" + ITEM_SEP.join(tokens) + CLOSE


class SanitizeEntityTests(unittest.TestCase):
    def test_entity_replaced_with_name(self):
        text = f"出自歌曲：{_entity('song', '爱丫爱丫', 'BY2歌曲')}演唱"
        out = sanitize(text, {}, {}, [0])
        self.assertEqual(out, "出自歌曲：爱丫爱丫演唱")

    def test_orphan_pua_chars_dropped(self):
        text = f"前缀{OPEN}cite{FIELD_SEP}turn0search0{CLOSE}尾"
        out = sanitize(text, {}, {}, [0])
        self.assertEqual(out, "前缀尾")

    def test_unclosed_block_kept_for_next_frame(self):
        text = f"出自{OPEN}entity[\"song\",\"爱丫"
        out = sanitize(text, {}, {}, [0])
        self.assertEqual(out, "出自")

    def test_lone_pua_chars_swept(self):
        text = f"a{FIELD_SEP}b{ITEM_SEP}c"
        out = sanitize(text, {}, {}, [0])
        self.assertEqual(out, "abc")


class SanitizeCiteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.cite = _cite("turn0search2", "turn0search1")
        self.references = {
            self.cite: {
                "url": "",
                "title": "",
                "items": [
                    {"url": "https://example.com/by2", "title": "BY2"},
                    {"url": "https://example.com/song", "title": "song"},
                ],
            }
        }

    def test_cite_replaced_with_markdown_link(self):
        text = f"出自 BY2 歌曲。{self.cite}"
        numbers: dict[str, int] = {}
        out = sanitize(text, self.references, numbers, [0])
        self.assertEqual(out, "出自 BY2 歌曲。[[1]](https://example.com/by2)")
        self.assertEqual(numbers, {self.cite: 1})

    def test_cite_dropped_when_no_metadata(self):
        text = f"出自 BY2 歌曲。{self.cite}"
        out = sanitize(text, {}, {}, [0])
        self.assertEqual(out, "出自 BY2 歌曲。")

    def test_repeated_cite_reuses_number(self):
        text = f"句一。{self.cite}句二。{self.cite}"
        numbers: dict[str, int] = {}
        counter = [0]
        out = sanitize(text, self.references, numbers, counter)
        self.assertEqual(
            out,
            "句一。[[1]](https://example.com/by2)句二。[[1]](https://example.com/by2)",
        )
        self.assertEqual(numbers, {self.cite: 1})


class CollectReferencesTests(unittest.TestCase):
    def test_walk_into_nested_event(self):
        cite = _cite("turn0search2")
        event = {
            "v": {
                "message": {
                    "metadata": {
                        "content_references": [
                            {
                                "matched_text": cite,
                                "url": "",
                                "title": "",
                                "items": [{"url": "https://example.com", "title": "Example"}],
                            }
                        ]
                    }
                }
            }
        }
        refs: dict[str, dict[str, object]] = {}
        collect_references(event, refs)
        self.assertIn(cite, refs)
        self.assertEqual(refs[cite]["items"][0]["url"], "https://example.com")


class StreamingDeltaTests(unittest.TestCase):
    """模拟上游 SSE 帧：cite 元数据帧在前、文本 patch 在后；半截标记跨帧到达。"""

    def test_full_pipeline_strips_markup_in_deltas(self):
        cite = _cite("turn0search2")
        meta_event = {
            "v": {
                "message": {
                    "metadata": {
                        "content_references": [
                            {
                                "matched_text": cite,
                                "items": [{"url": "https://example.com", "title": "ex"}],
                            }
                        ]
                    }
                }
            }
        }
        entity = _entity("song", "爱丫爱丫", "BY2歌曲")
        text_full = f"出自歌曲：{entity}{cite}"
        import json as _json
        payloads = [
            _json.dumps(meta_event),
            _json.dumps({"p": "/message/content/parts/0", "o": "append", "v": "出自歌曲："}),
            _json.dumps({"p": "/message/content/parts/0", "o": "append", "v": entity[:5]}),
            _json.dumps({"p": "/message/content/parts/0", "o": "append", "v": entity[5:]}),
            _json.dumps({"p": "/message/content/parts/0", "o": "append", "v": cite}),
            "[DONE]",
        ]
        deltas: list[str] = []
        final_text = ""
        for event in iter_conversation_payloads(iter(payloads)):
            if event["type"] == "conversation.delta":
                deltas.append(event["delta"])
                final_text = event["text"]
        joined = "".join(deltas)
        self.assertEqual(joined, "出自歌曲：爱丫爱丫[[1]](https://example.com)")
        self.assertEqual(final_text, "出自歌曲：爱丫爱丫[[1]](https://example.com)")
        self.assertNotIn(OPEN, joined)
        self.assertNotIn(CLOSE, joined)


if __name__ == "__main__":
    unittest.main()
