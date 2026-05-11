package momo.api.config

import munit.FunSuite

class AppConfigSpec extends FunSuite:

  test("toJdbcUrl: converts postgres:// URL and extracts credentials") {
    val (url, user, pass) = AppConfig.toJdbcUrl("postgres://summit:summit@localhost:5433/summit")
    assertEquals(url, "jdbc:postgresql://localhost:5433/summit")
    assertEquals(user, Some("summit"))
    assertEquals(pass, Some("summit"))
  }

  test("toJdbcUrl: converts postgresql:// URL") {
    val (url, user, pass) = AppConfig.toJdbcUrl("postgresql://user:secret@db.example.com/mydb")
    assertEquals(url, "jdbc:postgresql://db.example.com/mydb")
    assertEquals(user, Some("user"))
    assertEquals(pass, Some("secret"))
  }

  test("toJdbcUrl: passes through jdbc:postgresql:// URLs unchanged") {
    val raw = "jdbc:postgresql://localhost:5432/mydb"
    val (url, user, pass) = AppConfig.toJdbcUrl(raw)
    assertEquals(url, raw)
    assertEquals(user, None)
    assertEquals(pass, None)
  }

  test("toJdbcUrl: handles URL with query params (e.g. sslmode=require)") {
    val (url, user, pass) = AppConfig.toJdbcUrl("postgres://u:p@host/db?sslmode=require")
    assertEquals(url, "jdbc:postgresql://host/db?sslmode=require")
    assertEquals(user, Some("u"))
    assertEquals(pass, Some("p"))
  }

  test("toJdbcUrl: handles URL without credentials") {
    val (url, user, pass) = AppConfig.toJdbcUrl("postgres://localhost:5432/summit")
    assertEquals(url, "jdbc:postgresql://localhost:5432/summit")
    assertEquals(user, None)
    assertEquals(pass, None)
  }

  test("ensureProdSslMode: appends sslmode=require in prod when missing") {
    val result = AppConfig.ensureProdSslMode("jdbc:postgresql://db.example.com/mydb", AppEnv.Prod)
    assertEquals(result, Right("jdbc:postgresql://db.example.com/mydb?sslmode=require"))
  }

  test("ensureProdSslMode: preserves existing strict sslmode in prod") {
    val result = AppConfig.ensureProdSslMode(
      "jdbc:postgresql://db.example.com/mydb?connectTimeout=10&sslmode=verify-full",
      AppEnv.Prod,
    )
    assertEquals(
      result,
      Right("jdbc:postgresql://db.example.com/mydb?connectTimeout=10&sslmode=verify-full"),
    )
  }

  test("ensureProdSslMode: rejects weak sslmode in prod") {
    val result = AppConfig
      .ensureProdSslMode("jdbc:postgresql://db.example.com/mydb?sslmode=disable", AppEnv.Prod)
    assert(result.isLeft, s"expected weak sslmode to be rejected: $result")
  }

  test("ensureProdSslMode: leaves non-prod URLs unchanged") {
    val result = AppConfig.ensureProdSslMode("jdbc:postgresql://localhost:5432/mydb", AppEnv.Test)
    assertEquals(result, Right("jdbc:postgresql://localhost:5432/mydb"))
  }
