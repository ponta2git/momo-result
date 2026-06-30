package momo.api.adapters.postgres

final class PostgresDataIntegrityException(message: String) extends RuntimeException(message)

object PostgresDataIntegrityException:
  def inconsistentRow(table: String, id: String, reason: String): PostgresDataIntegrityException =
    new PostgresDataIntegrityException(s"$table row $id is inconsistent: $reason")

  def invalidPayload(table: String, id: String, field: String, reason: String)
      : PostgresDataIntegrityException =
    new PostgresDataIntegrityException(s"$table row $id has invalid $field: $reason")
