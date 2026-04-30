from momo_ocr.app.composition import _with_sslmode_require


def test_adds_sslmode_require_for_remote_host() -> None:
    url = "postgres://user:pass@db.neon.tech/mydb"
    result = _with_sslmode_require(url)
    assert "sslmode=require" in result


def test_does_not_add_ssl_for_localhost() -> None:
    url = "postgres://summit:summit@localhost:5433/summit"
    result = _with_sslmode_require(url)
    assert "sslmode" not in result


def test_does_not_add_ssl_for_127_0_0_1() -> None:
    url = "postgres://summit:summit@127.0.0.1:5433/summit"
    result = _with_sslmode_require(url)
    assert "sslmode" not in result


def test_respects_explicit_sslmode_in_url() -> None:
    url = "postgres://user:pass@db.neon.tech/mydb?sslmode=disable"
    result = _with_sslmode_require(url)
    assert "sslmode=disable" in result
    assert result.count("sslmode=") == 1
