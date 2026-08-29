use std::{path::Path, time::Duration};

use futures_util::future::poll_fn;
use openssl::{
    error::ErrorStack,
    ssl::{SslConnector, SslMethod},
};
use postgres_openssl::{MakeTlsConnector, TlsStream};
use thiserror::Error;
use tokio::sync::watch;
use tokio_postgres::{AsyncMessage, Client, Config, Connection, Socket};
use tracing::error;

use crate::outbox::{OutboxKind, PostCommitEffects, PostCommitSink, PostCommitSinkClosed};

const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_TCP_USER_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const SERIES_ANALYSIS_OUTBOX_NOTIFICATION_CHANNEL: &str = "series_analysis_queue_outbox";
#[cfg(target_os = "linux")]
const SYSTEM_CA_BUNDLE: &str = "/etc/ssl/certs/ca-certificates.crt";

#[derive(Debug, Error)]
pub(crate) enum PostgresError {
    #[error("invalid PostgreSQL connection configuration")]
    InvalidConfiguration(#[source] tokio_postgres::Error),
    #[error("PostgreSQL TLS configuration failed")]
    TlsConfiguration(#[source] ErrorStack),
    #[error("PostgreSQL operation failed")]
    Postgres(#[from] tokio_postgres::Error),
}

#[derive(Debug, Error)]
pub(crate) enum OutboxNotificationError {
    #[error("series-analysis outbox notification PostgreSQL dependency failed")]
    Postgres(#[from] PostgresError),
    #[error("series-analysis outbox notification connection closed unexpectedly")]
    ConnectionClosed,
    #[error("series-analysis outbox notification violated its payload-free protocol")]
    InvalidNotification,
    #[error("series-analysis outbox notification sink closed unexpectedly")]
    SinkClosed(#[from] PostCommitSinkClosed),
    #[error("series-analysis outbox notification shutdown channel closed unexpectedly")]
    ShutdownChannelClosed,
}

/// A dedicated, already-subscribed connection that owns the cross-process outbox wake route.
pub(crate) struct SeriesAnalysisOutboxListener {
    // Retaining the client keeps the request side of the dedicated connection open while the
    // connection object is polled exclusively for asynchronous notifications.
    _client: Client,
    connection: Connection<Socket, TlsStream<Socket>>,
    sink: PostCommitSink,
}

impl OutboxNotificationError {
    #[must_use]
    pub(crate) const fn kind(&self) -> &'static str {
        match self {
            Self::Postgres(error) => error.kind(),
            Self::ConnectionClosed => "postgres_connection_closed",
            Self::InvalidNotification => "invalid_notification",
            Self::SinkClosed(_) => "outbox_wake_sink_closed",
            Self::ShutdownChannelClosed => "shutdown_channel_closed",
        }
    }
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
    let config = connection_config(database_url)?;
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

/// Opens and subscribes the dedicated payload-free `PostgreSQL` notification connection.
///
/// The listener owns a dedicated connection because the ordinary query connection intentionally
/// drives and discards asynchronous notices. Losing this connection is a structural peer exit;
/// the supervisor restarts the full coordination boundary, while the 30-minute cold deadline
/// remains the safety net for a notification lost between commits and reconnects.
///
/// # Errors
///
/// Returns a safe structural error when setup, the connection, notification protocol, or sink
/// stops satisfying the coordination contract.
pub(crate) async fn subscribe_to_series_analysis_outbox(
    database_url: &str,
    sink: PostCommitSink,
) -> Result<SeriesAnalysisOutboxListener, OutboxNotificationError> {
    let config = connection_config(database_url)?;
    let (client, mut connection) = config
        .connect(native_tls_connector()?)
        .await
        .map_err(PostgresError::from)?;

    {
        // PostgreSQL identifiers cannot be bind parameters. The interpolated value is a private
        // compile-time constant, never configuration or request input.
        let listen_statement = format!("LISTEN {SERIES_ANALYSIS_OUTBOX_NOTIFICATION_CHANNEL}");
        let subscription = client.batch_execute(&listen_statement);
        tokio::pin!(subscription);
        loop {
            tokio::select! {
                biased;
                result = &mut subscription => {
                    result.map_err(PostgresError::from)?;
                    break;
                }
                message = poll_fn(|context| connection.poll_message(context)) => {
                    handle_async_message(message, &sink)?;
                }
            }
        }
    }

    Ok(SeriesAnalysisOutboxListener {
        _client: client,
        connection,
        sink,
    })
}

impl SeriesAnalysisOutboxListener {
    /// Drives the already-established subscription until coordinated shutdown.
    ///
    /// # Errors
    ///
    /// Returns a structural error when the connection, payload-free protocol, local sink, or
    /// shutdown lifecycle is lost.
    pub(crate) async fn run(
        mut self,
        mut shutdown: watch::Receiver<bool>,
    ) -> Result<(), OutboxNotificationError> {
        loop {
            if *shutdown.borrow() {
                return Ok(());
            }
            tokio::select! {
                biased;
                changed = shutdown.changed() => {
                    require_open_shutdown_channel(changed)?;
                    if *shutdown.borrow() {
                        return Ok(());
                    }
                }
                message = poll_fn(|context| self.connection.poll_message(context)) => {
                    handle_async_message(message, &self.sink)?;
                }
            }
        }
    }
}

fn connection_config(database_url: &str) -> Result<Config, PostgresError> {
    let mut config = database_url
        .parse::<Config>()
        .map_err(PostgresError::InvalidConfiguration)?;
    if config.get_connect_timeout().is_none() {
        config.connect_timeout(DEFAULT_CONNECT_TIMEOUT);
    }
    if config.get_tcp_user_timeout().is_none() {
        config.tcp_user_timeout(DEFAULT_TCP_USER_TIMEOUT);
    }
    Ok(config)
}

fn handle_async_message(
    message: Option<Result<AsyncMessage, tokio_postgres::Error>>,
    sink: &PostCommitSink,
) -> Result<(), OutboxNotificationError> {
    match message {
        Some(Ok(message)) => match message {
            AsyncMessage::Notification(notification) => {
                submit_outbox_notification(notification.channel(), notification.payload(), sink)
            }
            AsyncMessage::Notice(_) | _ => Ok(()),
        },
        Some(Err(error)) => Err(OutboxNotificationError::Postgres(PostgresError::Postgres(
            error,
        ))),
        None => Err(OutboxNotificationError::ConnectionClosed),
    }
}

fn submit_outbox_notification(
    channel: &str,
    payload: &str,
    sink: &PostCommitSink,
) -> Result<(), OutboxNotificationError> {
    if channel != SERIES_ANALYSIS_OUTBOX_NOTIFICATION_CHANNEL || !payload.is_empty() {
        return Err(OutboxNotificationError::InvalidNotification);
    }
    sink.submit(PostCommitEffects::wake(OutboxKind::SeriesAnalysis))?;
    Ok(())
}

fn require_open_shutdown_channel(
    changed: Result<(), watch::error::RecvError>,
) -> Result<(), OutboxNotificationError> {
    changed.map_err(|_closed| OutboxNotificationError::ShutdownChannelClosed)
}

fn native_tls_connector() -> Result<MakeTlsConnector, PostgresError> {
    // Production connection strings can require RFC 5929 channel binding. The official
    // postgres-openssl adapter derives tls-server-end-point from OpenSSL's parsed peer
    // certificate while SslConnector keeps CA and hostname verification enabled.
    #[cfg(target_os = "linux")]
    let ca_file = Some(Path::new(SYSTEM_CA_BUNDLE));
    #[cfg(not(target_os = "linux"))]
    let ca_file = None;
    tls_connector(ca_file)
}

fn tls_connector(ca_file: Option<&Path>) -> Result<MakeTlsConnector, PostgresError> {
    let mut builder =
        SslConnector::builder(SslMethod::tls()).map_err(PostgresError::TlsConfiguration)?;
    if let Some(path) = ca_file {
        builder
            .set_ca_file(path)
            .map_err(PostgresError::TlsConfiguration)?;
    }
    Ok(MakeTlsConnector::new(builder.build()))
}

#[cfg(test)]
mod tests {
    use std::{
        error::Error,
        io::{self, Read, Write},
        net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream},
        path::Path,
        sync::mpsc::{self, Receiver},
        thread,
        time::Duration,
    };

    use openssl::{
        asn1::{Asn1Integer, Asn1Time},
        bn::BigNum,
        error::ErrorStack,
        hash::MessageDigest,
        pkey::{PKey, Private},
        rsa::Rsa,
        ssl::{SslAcceptor, SslMethod},
        x509::{
            X509, X509Name,
            extension::{BasicConstraints, ExtendedKeyUsage, KeyUsage, SubjectAlternativeName},
        },
    };
    use tempfile::NamedTempFile;
    use tokio_postgres::{Config, config::SslMode};

    use super::{
        OutboxNotificationError, SERIES_ANALYSIS_OUTBOX_NOTIFICATION_CHANNEL, handle_async_message,
        submit_outbox_notification, tls_connector,
    };
    use crate::outbox::{OutboxKind, PostCommitSink};

    const SSL_REQUEST: [u8; 8] = [0, 0, 0, 8, 4, 210, 22, 47];
    type TestError = Box<dyn Error + Send + Sync>;
    type HandshakeResult = Result<bool, String>;

    struct TestIdentity {
        certificate: X509,
        private_key: PKey<Private>,
        ca_certificate: X509,
    }

    #[test]
    fn analysis_outbox_notifications_are_fixed_and_payload_free() {
        let (sink, wake) = PostCommitSink::channel(OutboxKind::SeriesAnalysis);

        assert_eq!(
            SERIES_ANALYSIS_OUTBOX_NOTIFICATION_CHANNEL,
            "series_analysis_queue_outbox"
        );
        assert!(
            submit_outbox_notification(SERIES_ANALYSIS_OUTBOX_NOTIFICATION_CHANNEL, "", &sink,)
                .is_ok()
        );
        assert!(
            submit_outbox_notification(SERIES_ANALYSIS_OUTBOX_NOTIFICATION_CHANNEL, "", &sink,)
                .is_ok(),
            "a repeated commit hint must coalesce in the capacity-one sink"
        );
        assert!(matches!(
            submit_outbox_notification("another_channel", "", &sink),
            Err(OutboxNotificationError::InvalidNotification)
        ));
        assert!(matches!(
            submit_outbox_notification(
                SERIES_ANALYSIS_OUTBOX_NOTIFICATION_CHANNEL,
                "job-identity-is-forbidden",
                &sink,
            ),
            Err(OutboxNotificationError::InvalidNotification)
        ));
        assert!(matches!(
            handle_async_message(None, &sink),
            Err(OutboxNotificationError::ConnectionClosed)
        ));

        drop(wake);
        assert!(matches!(
            submit_outbox_notification(SERIES_ANALYSIS_OUTBOX_NOTIFICATION_CHANNEL, "", &sink,),
            Err(OutboxNotificationError::SinkClosed(_))
        ));
    }

    #[tokio::test]
    async fn enforces_peer_and_hostname_verification() -> Result<(), TestError> {
        let identity = test_identity("database.example")?;
        let mut ca_file = NamedTempFile::new()?;
        let ca_pem = identity.ca_certificate.to_pem()?;
        ca_file.write_all(&ca_pem)?;

        for (context, tls_host, trust_ca, expected_accepted) in [
            (
                "trusted matching certificate",
                "database.example",
                true,
                true,
            ),
            (
                "untrusted peer certificate",
                "database.example",
                false,
                false,
            ),
            ("hostname mismatch", "other.example", true, false),
        ] {
            verify_handshake(
                &identity,
                ca_file.path(),
                context,
                tls_host,
                trust_ca,
                expected_accepted,
            )
            .await?;
        }
        Ok(())
    }

    async fn verify_handshake(
        identity: &TestIdentity,
        ca_file: &Path,
        context: &str,
        tls_host: &str,
        trust_ca: bool,
        expected_accepted: bool,
    ) -> Result<(), TestError> {
        let (address, handshake) = start_tls_server(identity)?;
        let connector = tls_connector(trust_ca.then_some(ca_file))?;
        let mut config = Config::new();
        config
            .host(tls_host)
            .hostaddr(IpAddr::V4(Ipv4Addr::LOCALHOST))
            .port(address.port())
            .user("test")
            .dbname("test")
            .ssl_mode(SslMode::Require)
            .connect_timeout(Duration::from_secs(2));

        drop(config.connect(connector).await);
        let accepted = handshake
            .recv_timeout(Duration::from_secs(2))
            .map_err(|error| {
                io::Error::other(format!("{context}: TLS server did not report: {error}"))
            })?
            .map_err(|error| io::Error::other(format!("{context}: TLS server failed: {error}")))?;
        if accepted != expected_accepted {
            return Err(io::Error::other(format!(
                "{context}: expected TLS handshake accepted={expected_accepted}, got {accepted}"
            ))
            .into());
        }
        Ok(())
    }

    fn start_tls_server(
        identity: &TestIdentity,
    ) -> Result<(SocketAddr, Receiver<HandshakeResult>), TestError> {
        let mut acceptor = SslAcceptor::mozilla_intermediate(SslMethod::tls_server())?;
        acceptor.set_private_key(&identity.private_key)?;
        acceptor.set_certificate(&identity.certificate)?;
        acceptor.add_extra_chain_cert(identity.ca_certificate.clone())?;
        acceptor.check_private_key()?;
        let acceptor = acceptor.build();
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let address = listener.local_addr()?;
        let (sender, receiver) = mpsc::channel();
        let _server_thread = thread::spawn(move || {
            let result =
                serve_one_tls_handshake(&listener, &acceptor).map_err(|error| error.to_string());
            drop(sender.send(result));
        });
        Ok((address, receiver))
    }

    fn serve_one_tls_handshake(
        listener: &TcpListener,
        acceptor: &SslAcceptor,
    ) -> Result<bool, TestError> {
        let (mut stream, _peer) = listener.accept()?;
        require_ssl_request(&mut stream)?;
        stream.write_all(b"S")?;
        Ok(acceptor.accept(stream).is_ok())
    }

    fn require_ssl_request(stream: &mut TcpStream) -> Result<(), TestError> {
        let mut request = [0_u8; SSL_REQUEST.len()];
        stream.read_exact(&mut request)?;
        if request != SSL_REQUEST {
            return Err(io::Error::other("client did not send a PostgreSQL SSLRequest").into());
        }
        Ok(())
    }

    fn test_identity(server_host: &str) -> Result<TestIdentity, ErrorStack> {
        let ca_private_key = PKey::from_rsa(Rsa::generate(2048)?)?;
        let ca_name = common_name("momo-postgres-test-ca")?;
        let mut ca_builder = X509::builder()?;
        ca_builder.set_version(2)?;
        let ca_serial = serial_number(1)?;
        ca_builder.set_serial_number(&ca_serial)?;
        ca_builder.set_subject_name(&ca_name)?;
        ca_builder.set_issuer_name(&ca_name)?;
        ca_builder.set_pubkey(&ca_private_key)?;
        let ca_not_before = Asn1Time::days_from_now(0)?;
        let ca_not_after = Asn1Time::days_from_now(1)?;
        ca_builder.set_not_before(&ca_not_before)?;
        ca_builder.set_not_after(&ca_not_after)?;
        ca_builder.append_extension(BasicConstraints::new().critical().ca().build()?)?;
        ca_builder.append_extension(KeyUsage::new().key_cert_sign().crl_sign().build()?)?;
        ca_builder.sign(&ca_private_key, MessageDigest::sha256())?;
        let ca_certificate = ca_builder.build();

        let private_key = PKey::from_rsa(Rsa::generate(2048)?)?;
        let server_name = common_name(server_host)?;
        let mut certificate_builder = X509::builder()?;
        certificate_builder.set_version(2)?;
        let certificate_serial = serial_number(2)?;
        certificate_builder.set_serial_number(&certificate_serial)?;
        certificate_builder.set_subject_name(&server_name)?;
        certificate_builder.set_issuer_name(ca_certificate.subject_name())?;
        certificate_builder.set_pubkey(&private_key)?;
        let certificate_not_before = Asn1Time::days_from_now(0)?;
        let certificate_not_after = Asn1Time::days_from_now(1)?;
        certificate_builder.set_not_before(&certificate_not_before)?;
        certificate_builder.set_not_after(&certificate_not_after)?;
        certificate_builder.append_extension(BasicConstraints::new().critical().build()?)?;
        certificate_builder.append_extension(
            KeyUsage::new()
                .digital_signature()
                .key_encipherment()
                .build()?,
        )?;
        certificate_builder.append_extension(ExtendedKeyUsage::new().server_auth().build()?)?;
        let subject_alternative_name = {
            let mut names = SubjectAlternativeName::new();
            if server_host.parse::<IpAddr>().is_ok() {
                names.ip(server_host);
            } else {
                names.dns(server_host);
            }
            names.build(&certificate_builder.x509v3_context(Some(&ca_certificate), None))?
        };
        certificate_builder.append_extension(subject_alternative_name)?;
        certificate_builder.sign(&ca_private_key, MessageDigest::sha256())?;

        Ok(TestIdentity {
            certificate: certificate_builder.build(),
            private_key,
            ca_certificate,
        })
    }

    fn common_name(value: &str) -> Result<X509Name, ErrorStack> {
        let mut builder = X509Name::builder()?;
        builder.append_entry_by_text("CN", value)?;
        Ok(builder.build())
    }

    fn serial_number(value: u32) -> Result<Asn1Integer, ErrorStack> {
        BigNum::from_u32(value)?.to_asn1_integer()
    }
}
