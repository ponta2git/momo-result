package momo.api.testing

object TestTags:
  val Integration = new munit.Tag("Integration")
  val DbIntegration = new munit.Tag("DbIntegration")
  val RedisIntegration = new munit.Tag("RedisIntegration")
