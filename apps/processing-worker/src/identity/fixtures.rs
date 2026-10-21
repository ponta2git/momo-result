//! Session-local constructors for synthetic database fixtures.
use crate::postgres::{ConnectedClient, PostgresError};

pub(crate) async fn connect(database_url: &str) -> Result<ConnectedClient, PostgresError> {
    let client = crate::postgres::connect(database_url).await?;
    client
        .batch_execute(include_str!("../../testdata/canonical-fixture.sql"))
        .await?;
    Ok(client)
}
