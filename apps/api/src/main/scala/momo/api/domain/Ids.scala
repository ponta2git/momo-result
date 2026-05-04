package momo.api.domain

import java.security.SecureRandom
import java.util.UUID

import scala.annotation.targetName

import cats.effect.Sync

object ids:
  opaque type JobId = String
  opaque type DraftId = String
  opaque type ImageId = String
  opaque type MemberId = String

  object JobId:
    def apply(value: String): JobId = value
  object DraftId:
    def apply(value: String): DraftId = value
  object ImageId:
    def apply(value: String): ImageId = value
  object MemberId:
    def apply(value: String): MemberId = value

  extension (id: JobId)
    @targetName("jobIdValue")
    def value: String = id
  extension (id: DraftId)
    @targetName("draftIdValue")
    def value: String = id
  extension (id: ImageId)
    @targetName("imageIdValue")
    def value: String = id
  extension (id: MemberId)
    @targetName("memberIdValue")
    def value: String = id

object IdGenerator:
  private val random = SecureRandom()

  /** Time-ordered random identifier (UUIDv7). */
  def next[F[_]: Sync]: F[String] = Sync[F].delay {
    val now = System.currentTimeMillis()
    val randA = random.nextInt(0x1000)
    val randB = random.nextLong() & 0x3fffffffffffffffL
    val most = (now << 16) | 0x7000L | randA.toLong
    val least = 0x8000000000000000L | randB
    UUID(most, least).toString
  }
