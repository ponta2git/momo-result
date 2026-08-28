use std::{path::Path, time::Duration};

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
pub(crate) enum PostgresError {
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

    use super::tls_connector;

    const SSL_REQUEST: [u8; 8] = [0, 0, 0, 8, 4, 210, 22, 47];
    type TestError = Box<dyn Error + Send + Sync>;
    type HandshakeResult = Result<bool, String>;

    struct TestIdentity {
        certificate: X509,
        private_key: PKey<Private>,
        ca_certificate: X509,
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
