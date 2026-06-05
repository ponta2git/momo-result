from __future__ import annotations

from pathlib import Path

from momo_ocr.features.ocr_domain.models import ScreenType
from momo_ocr.features.ocr_results.parsing import ScreenParseContext
from momo_ocr.features.ocr_results.player_aliases import alias_resolver_from_member_aliases
from momo_ocr.features.revenue.parser import RevenueParser
from momo_ocr.features.revenue.postprocess import parse_man_yen
from tests.support.images import write_test_image
from tests.support.text_recognition import SequenceTextRecognitionEngine


def test_parse_man_yen_handles_zero_yen_revenue() -> None:
    assert parse_man_yen("1億5800万円") == 15800
    assert parse_man_yen("1億5700万円 | NO11 社長 148570044") == 15700
    assert (
        parse_man_yen("オータカ社長 6300万円 | オータカ社長 8300万円 | オータカ社長 8300万円")
        == 8300
    )
    assert parse_man_yen("9100万円") == 9100
    assert parse_man_yen("0円") == 0
    assert parse_man_yen("オータカ社長 OF a") == 0
    assert parse_man_yen("ぽんた社長 on FX") == 0
    assert parse_man_yen("ぽんた社長 Om fae") == 0
    assert parse_man_yen("random of noise") is None


def test_revenue_parser_extracts_ranked_players_and_amounts(tmp_path: Path) -> None:
    image_path = tmp_path / "revenue.jpg"
    debug_dir = tmp_path / "debug"
    write_test_image(image_path)
    engine = SequenceTextRecognitionEngine(
        [
            "] 《 NO1 1社長 1億5800万円 | 6",
            "寺w4.11 ドー | & 148580059 | NO1 1 社長 1億5800万円",
            "ぽんた社長 9100万円",
            "ぽんた社長 9100万円",
            "に Ad おたか社長 5000万円 回",
            "Ad おたか社長 5000万円",
            "A いーゆー社長 0円",
            "A いーゆー社長 0円",
        ]
    )

    payload = RevenueParser().parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=ScreenType.AUTO,
            detected_screen_type=ScreenType.REVENUE,
            profile_id="full-hd-revenue-v1",
            debug_dir=debug_dir,
            include_raw_text=True,
            text_engine=engine,
        )
    )

    assert payload.category_payload["status"] == "parsed"
    assert [player.rank.value for player in payload.players] == [1, 2, 3, 4]
    assert [player.raw_player_name.value for player in payload.players] == [
        "NO11社長",
        "ぽんた社長",
        "オータカ社長",
        "いーゆー社長",
    ]
    assert [player.revenue_man_yen.value for player in payload.players] == [
        15800,
        9100,
        5000,
        0,
    ]
    assert payload.raw_snippets is not None
    assert payload.raw_snippets["rank_4"] == "A いーゆー社長 0円"
    assert (debug_dir / "revenue" / "rank_1_row_prepared.png").exists()


def test_revenue_parser_warns_for_unreadable_row(tmp_path: Path) -> None:
    image_path = tmp_path / "revenue.jpg"
    write_test_image(image_path)
    engine = SequenceTextRecognitionEngine(["unknown"] * 32)

    payload = RevenueParser().parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=ScreenType.REVENUE,
            detected_screen_type=ScreenType.REVENUE,
            profile_id="full-hd-revenue-v1",
            debug_dir=None,
            include_raw_text=False,
            text_engine=engine,
        )
    )

    assert payload.players[0].raw_player_name.value is None
    assert payload.players[0].revenue_man_yen.value is None
    assert {warning.code.value for warning in payload.warnings} == {
        "MISSING_AMOUNT",
        "UNKNOWN_PLAYER_ALIAS",
    }


def test_revenue_parser_warns_when_multiple_rows_resolve_to_same_member(
    tmp_path: Path,
) -> None:
    image_path = tmp_path / "revenue.jpg"
    write_test_image(image_path)
    engine = SequenceTextRecognitionEngine(
        [
            "PONTA社長 1億円",
            "PONTA社長 1億円",
            "PONTA別名社長 9000万円",
            "PONTA別名社長 9000万円",
            "OTAKA社長 8000万円",
            "OTAKA社長 8000万円",
            "いーゆー社長 7000万円",
            "いーゆー社長 7000万円",
        ]
    )

    payload = RevenueParser().parse(
        ScreenParseContext(
            image_path=image_path,
            requested_screen_type=ScreenType.REVENUE,
            detected_screen_type=ScreenType.REVENUE,
            profile_id="full-hd-revenue-v1",
            debug_dir=None,
            include_raw_text=False,
            text_engine=engine,
            alias_resolver=alias_resolver_from_member_aliases(
                {
                    "member-ponta": ("PONTA社長", "PONTA別名社長"),
                    "member-otaka": ("OTAKA社長",),
                    "member-eu": ("いーゆー社長",),
                }
            ),
        )
    )

    duplicate_warnings = [
        warning for warning in payload.warnings if warning.code.value == "DUPLICATE_MEMBER_ALIAS"
    ]
    assert [player.member_id for player in payload.players] == [
        "member-ponta",
        "member-ponta",
        "member-otaka",
        "member-eu",
    ]
    assert len(duplicate_warnings) == 1
    assert duplicate_warnings[0].field_path == "players[1].member_id"
