//! A real `PostgreSQL` connection with controlled response latency, without changing SQL semantics.

use std::{error::Error, io, time::Duration};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    task::{JoinHandle, JoinSet},
};

pub(crate) struct DelayedDatabase {
    pub(crate) url: String,
    listener: JoinHandle<()>,
}

impl DelayedDatabase {
    pub(crate) async fn start(
        database_url: &str,
        latency: Duration,
    ) -> Result<Self, Box<dyn Error + Send + Sync>> {
        let mut url = url::Url::parse(database_url)?;
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
                            relay(client, server, latency).await
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
