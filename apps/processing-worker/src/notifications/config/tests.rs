use std::{error::Error, time::Duration};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpSocket, TcpStream},
};

#[tokio::test]
async fn tcp_connection_can_recover_within_the_request_budget()
-> Result<(), Box<dyn Error + Send + Sync>> {
    let socket = TcpSocket::new_v4()?;
    socket.bind("127.0.0.1:0".parse()?)?;
    let listener = socket.listen(0)?;
    let address = listener.local_addr()?;
    // Linux admits one connection when backlog is zero. Until it is accepted,
    // another connection must wait for a TCP retransmission rather than HTTP retry.
    let filler = TcpStream::connect(address).await?;
    let server = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(1250)).await;
        drop(listener.accept().await?.0);
        let (mut stream, _) = listener.accept().await?;
        let mut request = [0; 1024];
        let _read = stream.read(&mut request).await?;
        stream
            .write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n")
            .await?;
        Ok::<(), std::io::Error>(())
    });
    let result = super::client()?
        .get(format!("http://{address}/internal/discord-notifications"))
        .send()
        .await;
    if result.is_err() {
        server.abort();
    }
    let response = result?;
    if response.status() != reqwest::StatusCode::NO_CONTENT {
        return Err("one request must survive a brief connection stall".into());
    }
    server.await??;
    drop(filler);
    Ok(())
}
