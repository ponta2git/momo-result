//! Normal execution requires the complete canonical storage shape. Frozen readiness bypasses it.
use tokio_postgres::Client;

use super::Entity;
use crate::postgres::PostgresError;

#[cfg(test)]
mod tests;

pub(crate) async fn require(client: &Client) -> Result<(), PostgresError> {
    tokio::time::timeout(std::time::Duration::from_secs(10), check(client))
        .await
        .map_err(|_elapsed| PostgresError::ConnectionTimeout)?
}

async fn check(client: &Client) -> Result<(), PostgresError> {
    let columns: serde_json::Value = serde_json::from_str(include_str!("canonical-columns.json"))
        .map_err(|_error| PostgresError::IncompatibleIdentitySchema)?;
    let identities: Vec<_> = Entity::ALL
        .into_iter()
        .map(Entity::identity_table)
        .collect();
    let compatible = client.query_one(
        "WITH expected AS (SELECT * FROM jsonb_to_recordset($1) AS item(table_name text,column_name text,data_type text,not_null boolean)), \
         missing_column AS (SELECT 1 FROM expected e LEFT JOIN pg_namespace n ON n.nspname='public' \
           LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=e.table_name AND c.relkind='r' \
           LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname=e.column_name AND a.attnum>0 AND NOT a.attisdropped \
           LEFT JOIN pg_type t ON t.oid=a.atttypid WHERE t.typname IS DISTINCT FROM e.data_type OR a.attnotnull IS DISTINCT FROM e.not_null), \
         identities AS (SELECT c.oid,id.attnum AS id,legacy.attnum AS legacy FROM unnest($2::text[]) name \
           JOIN pg_namespace n ON n.nspname='public' JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=name \
           JOIN pg_attribute id ON id.attrelid=c.oid AND id.attname='id' AND NOT id.attisdropped \
           JOIN pg_attribute legacy ON legacy.attrelid=c.oid AND legacy.attname='legacy_id' AND NOT legacy.attisdropped) \
         SELECT NOT EXISTS(SELECT 1 FROM missing_column) AND (SELECT count(*) FROM identities)=cardinality($2::text[]) \
           AND NOT EXISTS(SELECT 1 FROM identities i WHERE NOT EXISTS(SELECT 1 FROM pg_constraint p WHERE p.conrelid=i.oid AND p.contype='p' AND p.conkey=ARRAY[i.id]) \
             OR NOT EXISTS(SELECT 1 FROM pg_constraint u WHERE u.conrelid=i.oid AND u.contype='u' AND u.conkey=ARRAY[i.legacy]))",
        &[&columns, &identities],
    ).await?.try_get::<_, bool>(0)?;
    if compatible && relationships_match(client).await? {
        Ok(())
    } else {
        Err(PostgresError::IncompatibleIdentitySchema)
    }
}

async fn relationships_match(client: &Client) -> Result<bool, PostgresError> {
    // Deparsing a CHECK takes a relation lock. Materialize only the retained-pair tables first,
    // so the planner cannot deparse unrelated constraints behind an input-table write lock.
    let expected: serde_json::Value =
        serde_json::from_str(include_str!("canonical-relationships.json"))
            .map_err(|_error| PostgresError::IncompatibleIdentitySchema)?;
    Ok(client.query_one(
        "WITH expected_fks AS (SELECT * FROM jsonb_to_recordset($1::jsonb->'foreign_keys') AS item(table_name text,columns text[],target_table text,target_columns text[],on_delete text,on_update text)), \
         expected_keys AS (SELECT * FROM jsonb_to_recordset($1::jsonb->'unique_keys') AS item(table_name text,columns text[],\"primary\" boolean)), \
         expected_pairs AS (SELECT * FROM jsonb_to_recordset($1::jsonb->'retained_null_pairs') AS item(table_name text,expression text)), \
         pair_constraints AS MATERIALIZED (SELECT t.relname,c.conbin,c.conrelid FROM pg_constraint c \
           JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace \
           WHERE n.nspname='public' AND c.contype='c' AND c.convalidated \
             AND t.relname IN (SELECT table_name FROM expected_pairs)) \
         SELECT NOT EXISTS(SELECT 1 FROM expected_fks e WHERE NOT EXISTS( \
           SELECT 1 FROM pg_constraint f JOIN pg_class s ON s.oid=f.conrelid JOIN pg_namespace sn ON sn.oid=s.relnamespace \
             JOIN pg_class t ON t.oid=f.confrelid JOIN pg_namespace tn ON tn.oid=t.relnamespace \
           WHERE f.contype='f' AND f.convalidated AND sn.nspname='public' AND tn.nspname='public' \
             AND s.relname=e.table_name AND t.relname=e.target_table \
             AND f.confdeltype::text=e.on_delete AND f.confupdtype::text=e.on_update \
             AND ARRAY(SELECT a.attname::text FROM unnest(f.conkey) WITH ORDINALITY key(attnum,ord) JOIN pg_attribute a ON a.attrelid=s.oid AND a.attnum=key.attnum ORDER BY key.ord)=e.columns \
             AND ARRAY(SELECT a.attname::text FROM unnest(f.confkey) WITH ORDINALITY key(attnum,ord) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=key.attnum ORDER BY key.ord)=e.target_columns)) \
           AND NOT EXISTS(SELECT 1 FROM expected_keys e WHERE NOT EXISTS( \
             SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace \
             WHERE n.nspname='public' AND t.relname=e.table_name AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL \
               AND (NOT e.\"primary\" OR i.indisprimary) \
               AND ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY key(attnum,ord) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=key.attnum WHERE key.ord<=i.indnkeyatts ORDER BY key.ord)=e.columns)) \
           AND NOT EXISTS(SELECT 1 FROM expected_pairs e WHERE NOT EXISTS( \
             SELECT 1 FROM pair_constraints c WHERE c.relname=e.table_name \
               AND regexp_replace(lower(pg_get_expr(c.conbin,c.conrelid)), '[()\"[:space:]]', '', 'g')=e.expression))",
        &[&expected],
    ).await?.try_get(0)?)
}
