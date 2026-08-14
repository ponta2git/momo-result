use std::time::Duration;

use openssl::{
    error::ErrorStack,
    ssl::{SslConnector, SslMethod},
};
use postgres_openssl::MakeTlsConnector;
use thiserror::Error;
use tokio_postgres::{Client, Config};
use tracing::error;

const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_TCP_USER_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg(target_os = "linux")]
const SYSTEM_CA_BUNDLE: &str = "/etc/ssl/certs/ca-certificates.crt";

#[derive(Debug, Error)]
pub enum PostgresError {
    #[error("invalid PostgreSQL connection configuration")]
    InvalidConfiguration(#[source] tokio_postgres::Error),
    #[error("PostgreSQL TLS configuration failed")]
    TlsConfiguration(#[source] ErrorStack),
    #[error("PostgreSQL operation failed")]
    Postgres(#[from] tokio_postgres::Error),
}

impl PostgresError {
    #[must_use]
    pub(crate) const fn kind(&self) -> &'static str {
        match self {
            Self::InvalidConfiguration(_) => "postgres_configuration",
            Self::TlsConfiguration(_) => "postgres_tls_configuration",
            Self::Postgres(_) => "postgres_operation",
        }
    }
}

/// Opens a bounded asynchronous `PostgreSQL` connection and drives its I/O on the current runtime.
///
/// # Errors
///
/// Returns a safe error when configuration, trust roots, or the connection are invalid.
pub(crate) async fn connect(database_url: &str) -> Result<Client, PostgresError> {
    let mut config = database_url
        .parse::<Config>()
        .map_err(PostgresError::InvalidConfiguration)?;
    if config.get_connect_timeout().is_none() {
        config.connect_timeout(DEFAULT_CONNECT_TIMEOUT);
    }
    if config.get_tcp_user_timeout().is_none() {
        config.tcp_user_timeout(DEFAULT_TCP_USER_TIMEOUT);
    }
    let (client, connection) = config.connect(native_tls_connector()?).await?;
    tokio::spawn(async move {
        if let Err(_connection_error) = connection.await {
            error!(
                event = "analysis_dependency_connection_stopped",
                dependency = "postgresql",
                error_kind = "connection_driver",
                "analysis PostgreSQL connection stopped"
            );
        }
    });
    Ok(client)
}

fn native_tls_connector() -> Result<MakeTlsConnector, PostgresError> {
    // Production connection strings can require RFC 5929 channel binding. The official
    // postgres-openssl adapter derives tls-server-end-point from OpenSSL's parsed peer
    // certificate while SslConnector keeps CA and hostname verification enabled.
    let builder =
        SslConnector::builder(SslMethod::tls()).map_err(PostgresError::TlsConfiguration)?;
    #[cfg(target_os = "linux")]
    let builder = {
        let mut builder = builder;
        builder
            .set_ca_file(SYSTEM_CA_BUNDLE)
            .map_err(PostgresError::TlsConfiguration)?;
        builder
    };
    Ok(MakeTlsConnector::new(builder.build()))
}
