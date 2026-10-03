package momo.api.http

import java.io.EOFException
import java.nio.charset.StandardCharsets.UTF_8

import scala.concurrent.duration.*

import cats.data.Kleisli
import cats.effect.{Deferred, IO, Resource}
import cats.syntax.all.*
import com.comcast.ip4s.*
import fs2.io.net.{Network, Socket}
import fs2.{Chunk, Stream}
import org.http4s.ember.server.EmberServerBuilder
import org.http4s.{HttpApp, Request, Response, Status}
import scodec.bits.ByteVector

import momo.api.MomoCatsEffectSuite

final class RequestBodyAdmissionHttp2Spec extends MomoCatsEffectSuite:
  test("a reset before response headers releases read capacity through transfer logging") {
    for
      admission <- RequestBodyAdmission.create[IO](1L, 1L, 1L, 1L, 1L)
      responseReady <- Deferred[IO, Unit]
      returnResponse <- Deferred[IO, Unit]
      payloadEvaluations <- IO.ref(0)
      bodyFinalizations <- IO.ref(0)
      handled <- IO.ref(0)
      underlying = Kleisli[IO, Request[IO], Response[IO]] { request =>
        handled.update(_ + 1).as {
          if request.uri.path.renderString == "/api/canceled" then
            Response[IO](Status.Ok).withBodyStream(
              (Stream.exec(payloadEvaluations.update(_ + 1)) ++ Stream.emit[IO, Byte](1))
                .onFinalize(bodyFinalizations.update(_ + 1))
            )
          else Response[IO](Status.Ok).withEntity("recovered")
        }
      }
      logged = RequestDurationLoggingMiddleware(admission(underlying))
      // Hold the fully wrapped Response so the peer's reset is processed before the server
      // starts sending its headers. The PING acknowledgment below supplies the wire barrier.
      app = Kleisli[IO, Request[IO], Response[IO]] { request =>
        logged.run(request).flatMap { response =>
          if request.uri.path.renderString == "/api/canceled" then
            responseReady.complete(()).void *> returnResponse.get.as(response)
          else IO.pure(response)
        }
      }
      _ <- server(app).use { address =>
        peer(address).use { client =>
          (for
            _ <- client.get(1, "/api/canceled")
            _ <- responseReady.get.timeout(5.seconds)
            _ <- client.resetAndAwaitAck(1)
            _ <- returnResponse.complete(())
            _ <- client.get(3, "/api/next")
            first <- client.body(3).timeoutTo(
              5.seconds,
              (handled.get, payloadEvaluations.get, bodyFinalizations.get).tupled.flatMap {
                case (requests, evaluations, finalizations) =>
                  IO.raiseError(new AssertionError(
                    s"follow-up read stalled: handled=$requests payload=$evaluations " +
                      s"finalized=$finalizations"
                  ))
              },
            )
            _ <- client.get(5, "/api/another")
            second <- client.body(5).timeout(5.seconds)
            evaluations <- payloadEvaluations.get
            finalizations <- bodyFinalizations.get
          yield
            assertEquals(first, "recovered")
            assertEquals(second, "recovered")
            assertEquals(evaluations, 0, "reset responses must not execute their payload")
            assertEquals(finalizations, 1, "the abandoned body must be released exactly once")
          ).guarantee(returnResponse.complete(()).void)
        }
      }
    yield ()
  }

  private def server(app: HttpApp[IO]): Resource[IO, SocketAddress[Host]] =
    EmberServerBuilder.default[IO].withHost(host"127.0.0.1").withPort(port"0")
      .withHttp2.withHttpApp(app).withShutdownTimeout(1.second).build.map { running =>
        SocketAddress(host"127.0.0.1", Port.fromInt(running.address.getPort).get)
      }

  private def peer(address: SocketAddress[Host]): Resource[IO, Peer] =
    Network[IO].connect(address).evalMap { socket =>
      val client = new Peer(socket)
      client.initialize.as(client)
    }

  // A minimal prior-knowledge peer exposes RST_STREAM, which ordinary HTTP clients do not
  // let tests place between Response creation and header transmission. It uses only public
  // sockets and HTTP/2 wire fields; the actual server, HPACK encoder and middleware run intact.
  private final class Peer(socket: Socket[IO]):
    private val pingPayload = ByteVector.fromValidHex("0102030405060708")

    def initialize: IO[Unit] =
      socket.write(Chunk.array("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n".getBytes(UTF_8))) *>
        write(Frame(4, 0, 0, ByteVector.empty))

    def get(streamId: Int, path: String): IO[Unit] =
      // HPACK static-table indices: :method GET, :scheme http, :authority, :path.
      // Literal strings use no Huffman coding or dynamic table, so later requests are independent.
      val authority = "localhost".getBytes(UTF_8)
      val target = path.getBytes(UTF_8)
      val headers = ByteVector(0x82.toByte, 0x86.toByte, 0x01.toByte, authority.length.toByte) ++
        ByteVector.view(authority) ++ ByteVector(0x04.toByte, target.length.toByte) ++
        ByteVector.view(target)
      write(Frame(1, 5, streamId, headers)) // END_HEADERS | END_STREAM

    def resetAndAwaitAck(streamId: Int): IO[Unit] =
      write(Frame(3, 0, streamId, ByteVector.fromInt(8))) *> // CANCEL
        write(Frame(6, 0, 0, pingPayload)) *> awaitPingAck

    def body(streamId: Int): IO[String] =
      def collect(bytes: ByteVector): IO[String] = read.flatMap { frame =>
        if frame.streamId == streamId && frame.kind == 3 then
          IO.raiseError(new AssertionError(s"follow-up stream $streamId was reset"))
        else if frame.streamId == streamId && (frame.kind == 0 || frame.kind == 1) then
          val next = if frame.kind == 0 then bytes ++ frame.payload else bytes
          if (frame.flags & 1) != 0 then IO.pure(new String(next.toArray, UTF_8))
          else collect(next)
        else acknowledge(frame) *> collect(bytes)
      }
      collect(ByteVector.empty)

    private def awaitPingAck: IO[Unit] = read.flatMap { frame =>
      if frame.kind == 6 && (frame.flags & 1) != 0 &&
        frame.payload.toHex == pingPayload.toHex
      then IO.unit
      else acknowledge(frame) *> awaitPingAck
    }.timeout(5.seconds)

    private def acknowledge(frame: Frame): IO[Unit] =
      if frame.kind == 4 && (frame.flags & 1) == 0 then
        write(Frame(4, 1, 0, ByteVector.empty))
      else if frame.kind == 6 && (frame.flags & 1) == 0 then
        write(Frame(6, 1, 0, frame.payload))
      else if frame.kind == 7 then
        IO.raiseError(new AssertionError(s"HTTP/2 connection closed: ${frame.payload.toHex}"))
      else IO.unit

    private def write(frame: Frame): IO[Unit] =
      val length = frame.payload.length.toInt
      val header = ByteVector(
        (length >> 16).toByte,
        (length >> 8).toByte,
        length.toByte,
        frame.kind.toByte,
        frame.flags.toByte,
      ) ++ ByteVector.fromInt(frame.streamId)
      socket.write(Chunk.byteVector(header ++ frame.payload))

    private def read: IO[Frame] =
      for
        header <- readExactly(9)
        length = ((header(0) & 0xff) << 16) | ((header(1) & 0xff) << 8) | (header(2) & 0xff)
        payload <- readExactly(length)
      yield Frame(
        header(3) & 0xff,
        header(4) & 0xff,
        header.drop(5).toInt() & 0x7fffffff,
        payload,
      )

    private def readExactly(length: Int): IO[ByteVector] =
      if length == 0 then IO.pure(ByteVector.empty)
      else socket.readN(length).flatMap { bytes =>
        if bytes.size == length then IO.pure(bytes.toByteVector)
        else IO.raiseError(new EOFException("HTTP/2 peer closed before completing a frame"))
      }

  private final case class Frame(kind: Int, flags: Int, streamId: Int, payload: ByteVector)
