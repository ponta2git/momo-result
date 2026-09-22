//! A real `PostgreSQL` connection with controlled response latency, without changing SQL semantics.

use std::{error::Error, io, time::Duration};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    task::{JoinHandle, JoinSet},
};

#[derive(Clone, Copy)]
pub(crate) enum CommitFault {
    BeforeCommit,
    LostReply,
}

pub(crate) struct DelayedDatabase {
    pub(crate) url: String,
    listener: JoinHandle<()>,
}

impl DelayedDatabase {
    pub(crate) async fn start(
        database_url: &str,
        latency: Duration,
    ) -> Result<Self, Box<dyn Error + Send + Sync>> {
        Self::start_with_fault(database_url, latency, None).await
    }

    pub(crate) async fn commit_fault(
        database_url: &str,
        fault: CommitFault,
    ) -> Result<Self, Box<dyn Error + Send + Sync>> {
        Self::start_with_fault(database_url, Duration::ZERO, Some(fault)).await
    }

    async fn start_with_fault(
        database_url: &str,
        latency: Duration,
        fault: Option<CommitFault>,
    ) -> Result<Self, Box<dyn Error + Send + Sync>> {
        let mut url = url::Url::parse(database_url)?;
        if fault.is_some() {
            // Only the isolated test transport parses PostgreSQL frames; never production TLS.
            url.query_pairs_mut().append_pair("sslmode", "disable");
        }
        let host = url.host_str().ok_or("database host missing")?.to_owned();
        let port = url.port().unwrap_or(5432);
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        url.set_host(Some("127.0.0.1"))?;
        url.set_port(Some(listener.local_addr()?.port()))
            .map_err(|()| "database proxy port")?;
        let listener = tokio::spawn(async move {
            let mut connections = JoinSet::new();
            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        let Ok((client, _address)) = accepted else { break };
                        let host = host.clone();
                        connections.spawn(async move {
                            let server = TcpStream::connect((host.as_str(), port)).await?;
                            match fault {
                                Some(fault) => relay_commit_fault(client, server, fault).await,
                                None => relay(client, server, latency).await,
                            }
                        });
                    }
                    _completed = connections.join_next(), if !connections.is_empty() => {}
                }
            }
        });
        Ok(Self {
            url: url.to_string(),
            listener,
        })
    }
}

impl Drop for DelayedDatabase {
    fn drop(&mut self) {
        self.listener.abort();
    }
}

async fn relay(mut client: TcpStream, mut server: TcpStream, latency: Duration) -> io::Result<()> {
    let (mut client_read, mut client_write) = client.split();
    let (mut server_read, mut server_write) = server.split();
    tokio::try_join!(
        async {
            tokio::io::copy(&mut client_read, &mut server_write).await?;
            server_write.shutdown().await
        },
        async {
            let mut buffer = vec![0; 64 * 1024];
            loop {
                let count = server_read.read(&mut buffer).await?;
                if count == 0 {
                    break;
                }
                tokio::time::sleep(latency).await;
                client_write
                    .write_all(
                        buffer
                            .get(..count)
                            .ok_or_else(|| io::Error::other("response bound"))?,
                    )
                    .await?;
            }
            client_write.shutdown().await
        },
    )?;
    Ok(())
}

// PostgreSQL frames are decoded so fragmented TCP writes cannot bypass the injected fault.
async fn relay_commit_fault(
    mut client: TcpStream,
    mut server: TcpStream,
    fault: CommitFault,
) -> io::Result<()> {
    let (mut client_read, mut client_write) = client.split();
    let (mut server_read, mut server_write) = server.split();
    tokio::try_join!(
        async {
            let startup = read_body(&mut client_read).await?;
            write_body(&mut server_write, &startup).await?;
            loop {
                let tag = client_read.read_u8().await?;
                let body = read_body(&mut client_read).await?;
                if matches!(fault, CommitFault::BeforeCommit) && tag == b'Q' && body == b"COMMIT\0"
                {
                    return Err::<(), _>(io::Error::other("test disconnect before commit"));
                }
                server_write.write_u8(tag).await?;
                write_body(&mut server_write, &body).await?;
            }
        },
        async {
            loop {
                let tag = server_read.read_u8().await?;
                let body = read_body(&mut server_read).await?;
                if matches!(fault, CommitFault::LostReply) && tag == b'C' && body == b"COMMIT\0" {
                    return Err::<(), _>(io::Error::other("test lost commit response"));
                }
                client_write.write_u8(tag).await?;
                write_body(&mut client_write, &body).await?;
            }
        },
    )?;
    Ok(())
}

async fn read_body(reader: &mut (impl tokio::io::AsyncRead + Unpin)) -> io::Result<Vec<u8>> {
    let size = reader.read_u32().await?;
    let size = size
        .checked_sub(4)
        .filter(|size| *size <= 1024 * 1024)
        .ok_or_else(|| io::Error::other("test protocol frame bound"))?;
    let mut body = vec![0; usize::try_from(size).map_err(io::Error::other)?];
    reader.read_exact(&mut body).await?;
    Ok(body)
}

async fn write_body(
    writer: &mut (impl tokio::io::AsyncWrite + Unpin),
    body: &[u8],
) -> io::Result<()> {
    let size = u32::try_from(body.len()).map_err(io::Error::other)? + 4;
    writer.write_u32(size).await?;
    writer.write_all(body).await
}
