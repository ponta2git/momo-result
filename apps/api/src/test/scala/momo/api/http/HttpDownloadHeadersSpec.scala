package momo.api.http

import munit.FunSuite

final class HttpDownloadHeadersSpec extends FunSuite:
  test("builds attachment header for stable ASCII filenames"):
    assertEquals(
      HttpDownloadHeaders.attachment("momo-results-match-match-1.tsv"),
      Right("attachment; filename=\"momo-results-match-match-1.tsv\""),
    )

  test("rejects filenames that can escape or corrupt Content-Disposition"):
    val unsafe = List(
      "",
      ".hidden",
      "../secret.zip",
      "dir/file.zip",
      "bad\"name.zip",
      "bad\nname.zip",
      "momo結果.zip",
      "a" * 129 + ".zip",
    )

    unsafe.foreach { fileName =>
      assert(HttpDownloadHeaders.attachment(fileName).isLeft, s"accepted unsafe filename: $fileName")
    }
